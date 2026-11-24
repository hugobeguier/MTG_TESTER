// TEST HELPER ONLY: a human seat pays by hand, so a test that casts "and moves on" presses the banner's Auto-pay (suggest) twice (suggest, then confirm) when a payment is open.
import type { KernelGameController } from "./kernelController";

export function payIfAsked(c: KernelGameController): void {
  for (let i = 0; i < 2 && c.paying(); i++) c.boardPick()?.onConfirm();
}
