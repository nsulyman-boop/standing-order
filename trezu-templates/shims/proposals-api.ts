export interface FunctionCallAction {
  method_name: string;
  args: string;
  deposit: string;
  gas: string;
}
export interface FunctionCallKind {
  FunctionCall: { actions: FunctionCallAction[]; receiver_id: string };
}
