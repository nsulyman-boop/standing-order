//! Cross-chain payout routes: verifying NEAR Intents 1Click quotes on-chain.
//!
//! 1Click signs every quote with its manager key. The signed message is
//! `base58(sha256(stable_json({...signedRequestFields, ...signedQuoteFields, timestamp})))`
//! (see docs.near-intents.org → 1Click API → Verify Quote Signatures, and
//! `@defuse-protocol/one-click-sdk-typescript` `verifyQuoteSignature`). We rebuild that exact
//! message here, so a keeper can only route a payout through a deposit address that 1Click itself
//! attests will deliver the recipient's registered asset to the recipient's registered address.

use near_sdk::serde_json::{self, Value};
use near_sdk::{env, AccountId};

/// 1Click manager public key (ed25519, base58) as shipped in the official SDK.
pub const ONE_CLICK_MANAGER_PUB_KEY: &str = "reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/// Fields of a 1Click quote response that the contract relies on after verification.
#[derive(Debug, Clone)]
pub struct VerifiedQuote {
    pub deposit_address: AccountId,
    pub origin_asset: String,
    pub destination_asset: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub min_amount_out: u128,
    pub recipient: String,
    pub refund_to: String,
    pub deadline_seconds: u64,
    pub correlation_id: String,
}

/// Verify the signature on a raw 1Click quote response (`quoteRequest`, `quote`, `timestamp`,
/// `signature`) and extract the fields we need. Returns a human-readable error on failure.
pub fn verify_quote(raw: &str, public_key: &[u8; 32]) -> Result<VerifiedQuote, String> {
    let v: Value = serde_json::from_str(raw).map_err(|e| format!("quote is not valid JSON: {e}"))?;
    let req = v.get("quoteRequest").ok_or("quote missing quoteRequest")?;
    let quote = v.get("quote").ok_or("quote missing quote")?;
    let timestamp = v.get("timestamp").and_then(Value::as_str).ok_or("quote missing timestamp")?;
    let signature = v.get("signature").and_then(Value::as_str).ok_or("quote missing signature")?;
    if req.get("dry").and_then(Value::as_bool) != Some(false) {
        return Err("quote must be a non-dry quote".into());
    }
    // Only the plain shape we know how to bind: the keeper deposits the exact payout amount on
    // NEAR and 1Click delivers to the recipient's address on the destination chain.
    for (key, expected) in [("swapType", "EXACT_INPUT"), ("depositType", "ORIGIN_CHAIN"), ("recipientType", "DESTINATION_CHAIN")] {
        if req.get(key).and_then(Value::as_str) != Some(expected) {
            return Err(format!("quoteRequest.{key} must be {expected}"));
        }
    }

    let message = signed_message(req, quote, timestamp)?;
    let sig_bytes = bs58::decode(signature.strip_prefix("ed25519:").unwrap_or(signature))
        .into_vec()
        .map_err(|_| "signature is not base58")?;
    let sig: [u8; 64] = sig_bytes.try_into().map_err(|_| "signature must be 64 bytes")?;
    if !env::ed25519_verify(&sig, message.as_bytes(), public_key) {
        return Err("quote signature does not verify against the 1Click key".into());
    }

    let s = |obj: &Value, key: &str| -> Result<String, String> {
        obj.get(key).and_then(Value::as_str).map(str::to_string).ok_or_else(|| format!("quote missing {key}"))
    };
    let u = |obj: &Value, key: &str| -> Result<u128, String> {
        s(obj, key)?.parse::<u128>().map_err(|_| format!("quote field {key} is not an integer string"))
    };
    let deposit_address: AccountId = s(quote, "depositAddress")?.parse().map_err(|_| "depositAddress is not a NEAR account")?;
    let deadline = s(quote, "deadline")?;
    Ok(VerifiedQuote {
        deposit_address,
        origin_asset: s(req, "originAsset")?,
        destination_asset: s(req, "destinationAsset")?,
        amount_in: u(req, "amount")?,
        amount_out: u(quote, "amountOut")?,
        min_amount_out: u(quote, "minAmountOut")?,
        recipient: s(req, "recipient")?,
        refund_to: s(req, "refundTo")?,
        deadline_seconds: parse_rfc3339_seconds(&deadline).ok_or("quote deadline is not RFC 3339")?,
        correlation_id: v.get("correlationId").and_then(Value::as_str).unwrap_or("").to_string(),
    })
}

/// Rebuild the exact string 1Click signs: base58(sha256(json)) where json has the SDK's field
/// subset, keys sorted, compact, `undefined`/falsy-optional fields dropped.
pub fn signed_message(req: &Value, quote: &Value, timestamp: &str) -> Result<String, String> {
    let dry = req.get("dry").and_then(Value::as_bool).unwrap_or(true);
    // JS `{...request, ...quote, timestamp}`: later keys override earlier ones (e.g. `deadline`).
    let mut fields: std::collections::BTreeMap<&str, Value> = std::collections::BTreeMap::new();
    let mut push = |key: &'static str, val: Option<&Value>| {
        if let Some(v) = val {
            if !v.is_null() {
                fields.insert(key, v.clone());
            }
        }
    };
    // Request fields (always-present ones first).
    for key in ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"] {
        push(key, req.get(key));
    }
    // Optional request fields are included only when truthy (JS semantics).
    for key in ["quoteWaitingTimeMs", "referral", "virtualChainRecipient", "virtualChainRefundRecipient", "customRecipientMsg"] {
        if let Some(v) = req.get(key) {
            if is_truthy(v) {
                push(key, Some(v));
            }
        }
    }
    // Quote fields.
    for key in ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"] {
        push(key, quote.get(key));
    }
    if !dry {
        for key in ["depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"] {
            if let Some(v) = quote.get(key) {
                if is_truthy(v) {
                    push(key, Some(v));
                }
            }
        }
    }
    push("timestamp", Some(&Value::String(timestamp.to_string())));

    let mut json = String::from("{");
    for (i, (k, v)) in fields.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&serde_json::to_string(k).map_err(|e| e.to_string())?);
        json.push(':');
        json.push_str(&serde_json::to_string(v).map_err(|e| e.to_string())?);
    }
    json.push('}');
    let hash = env::sha256(json.as_bytes());
    Ok(bs58::encode(hash).into_string())
}

fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Parse `YYYY-MM-DDTHH:MM:SS[.fff]Z` into Unix seconds. UTC only, which is what 1Click emits.
pub fn parse_rfc3339_seconds(s: &str) -> Option<u64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let (y, m, day) = (d.next()?.parse::<i64>().ok()?, d.next()?.parse::<u32>().ok()?, d.next()?.parse::<u32>().ok()?);
    let time = time.split('.').next()?;
    let mut t = time.split(':');
    let (hh, mm, ss) = (t.next()?.parse::<u64>().ok()?, t.next()?.parse::<u64>().ok()?, t.next()?.parse::<u64>().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    // Howard Hinnant's days_from_civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    if days < 0 {
        return None;
    }
    Some(days as u64 * 86_400 + hh * 3600 + mm * 60 + ss)
}

/// Compare the address a quote delivers to with the one the recipient registered. EVM addresses
/// (`0x…`) are hex and compared case-insensitively (checksum casing varies); every other chain's
/// address, e.g. Solana base58, is case-sensitive and must match exactly.
pub fn destination_address_matches(registered: &str, quoted: &str) -> bool {
    if registered.starts_with("0x") {
        registered.eq_ignore_ascii_case(quoted)
    } else {
        registered == quoted
    }
}

pub fn decode_public_key(s: &str) -> Option<[u8; 32]> {
    let raw = s.strip_prefix("ed25519:").unwrap_or(s);
    bs58::decode(raw).into_vec().ok()?.try_into().ok()
}

pub fn encode_public_key(pk: &[u8; 32]) -> String {
    format!("ed25519:{}", bs58::encode(pk).into_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: &str = include_str!("../tests/fixtures/quote_live.json");
    const DRY: &str = include_str!("../tests/fixtures/quote_dry.json");

    fn key() -> [u8; 32] {
        decode_public_key(ONE_CLICK_MANAGER_PUB_KEY).unwrap()
    }

    #[test]
    fn real_live_quote_verifies() {
        let q = verify_quote(LIVE, &key()).expect("live fixture should verify");
        assert_eq!(q.deposit_address.as_str(), "702bb1cdf6e6d1f80776679b6e0f2745226efd76cda7563fe0f45ee1d1929d87");
        assert_eq!(q.amount_in, 3_000_000);
        assert_eq!(q.amount_out, 2_997_248);
        assert_eq!(q.refund_to, "dev1.near");
        assert_eq!(q.recipient, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
        assert_eq!(q.deadline_seconds, parse_rfc3339_seconds("2026-11-12T06:00:00.000Z").unwrap());
    }

    #[test]
    fn dry_quote_signature_matches_but_is_rejected_for_payouts() {
        let v: Value = serde_json::from_str(DRY).unwrap();
        let msg = signed_message(&v["quoteRequest"], &v["quote"], v["timestamp"].as_str().unwrap()).unwrap();
        let sig = bs58::decode(v["signature"].as_str().unwrap().trim_start_matches("ed25519:")).into_vec().unwrap();
        assert!(env::ed25519_verify(&sig.try_into().unwrap(), msg.as_bytes(), &key()), "dry signature should verify");
        assert!(verify_quote(DRY, &key()).unwrap_err().contains("non-dry"));
    }

    #[test]
    fn tampered_deposit_address_fails() {
        let tampered = LIVE.replace("702bb1cdf6e6d1f80776679b6e0f2745226efd76cda7563fe0f45ee1d1929d87", "attacker.near");
        assert!(verify_quote(&tampered, &key()).unwrap_err().contains("does not verify"));
    }

    #[test]
    fn tampered_amount_fails() {
        let tampered = LIVE.replace("\"amount\":\"3000000\"", "\"amount\":\"30000000\"");
        assert_ne!(tampered, LIVE);
        assert!(verify_quote(&tampered, &key()).is_err());
    }

    #[test]
    fn tampered_swap_type_fails_naming_the_field() {
        let tampered = LIVE.replace("\"swapType\":\"EXACT_INPUT\"", "\"swapType\":\"EXACT_OUTPUT\"");
        assert_ne!(tampered, LIVE);
        let err = verify_quote(&tampered, &key()).unwrap_err();
        assert!(err.contains("swapType") && err.contains("EXACT_INPUT"), "{err}");
    }

    #[test]
    fn tampered_deposit_type_fails_naming_the_field() {
        let tampered = LIVE.replace("\"depositType\":\"ORIGIN_CHAIN\"", "\"depositType\":\"INTENTS\"");
        assert_ne!(tampered, LIVE);
        let err = verify_quote(&tampered, &key()).unwrap_err();
        assert!(err.contains("depositType") && err.contains("ORIGIN_CHAIN"), "{err}");
    }

    #[test]
    fn tampered_recipient_type_fails_naming_the_field() {
        let tampered = LIVE.replace("\"recipientType\":\"DESTINATION_CHAIN\"", "\"recipientType\":\"INTENTS\"");
        assert_ne!(tampered, LIVE);
        let err = verify_quote(&tampered, &key()).unwrap_err();
        assert!(err.contains("recipientType") && err.contains("DESTINATION_CHAIN"), "{err}");
    }

    #[test]
    fn missing_shape_fields_fail_naming_the_field() {
        let no_swap = LIVE.replace("\"swapType\":\"EXACT_INPUT\",", "");
        assert_ne!(no_swap, LIVE);
        assert!(verify_quote(&no_swap, &key()).unwrap_err().contains("swapType"));
        let no_deposit = LIVE.replace("\"depositType\":\"ORIGIN_CHAIN\",", "");
        assert_ne!(no_deposit, LIVE);
        assert!(verify_quote(&no_deposit, &key()).unwrap_err().contains("depositType"));
        let no_recipient_type = LIVE.replace("\"recipientType\":\"DESTINATION_CHAIN\",", "");
        assert_ne!(no_recipient_type, LIVE);
        assert!(verify_quote(&no_recipient_type, &key()).unwrap_err().contains("recipientType"));
    }

    #[test]
    fn evm_addresses_match_case_insensitively_others_exactly() {
        let evm = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
        assert!(destination_address_matches(evm, evm));
        assert!(destination_address_matches(evm, &evm.to_lowercase()));
        assert!(destination_address_matches(evm, &evm.to_uppercase().replace("0X", "0x")));
        assert!(!destination_address_matches(evm, "0x1111111111111111111111111111111111111111"));
        let sol = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
        assert!(destination_address_matches(sol, sol));
        assert!(!destination_address_matches(sol, &sol.to_lowercase()));
        assert!(!destination_address_matches(sol, &sol.to_uppercase()));
        // Only a registered 0x address relaxes the comparison; a quoted 0x against a non-0x
        // registration (or vice versa) must still match exactly.
        assert!(!destination_address_matches(sol, evm));
        assert!(!destination_address_matches(&evm[2..], &evm[2..].to_lowercase()));
    }

    #[test]
    fn wrong_key_fails() {
        assert!(verify_quote(LIVE, &[7u8; 32]).unwrap_err().contains("does not verify"));
    }

    #[test]
    fn rfc3339_parsing() {
        assert_eq!(parse_rfc3339_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_seconds("2026-11-08T20:25:36.811Z"), Some(1_794_169_536));
        assert_eq!(parse_rfc3339_seconds("2000-03-01T00:00:00Z"), Some(951_868_800));
        assert!(parse_rfc3339_seconds("2026-11-08 20:25:36").is_none());
        assert!(parse_rfc3339_seconds("2026-13-08T20:25:36Z").is_none());
    }

    #[test]
    fn public_key_roundtrip() {
        let pk = key();
        assert_eq!(encode_public_key(&pk), format!("ed25519:{ONE_CLICK_MANAGER_PUB_KEY}"));
    }
}
