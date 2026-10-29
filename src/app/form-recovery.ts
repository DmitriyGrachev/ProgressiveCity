import { create } from "zustand";
import type { RecoveryRecord } from "../storage/recovery-journal";
export const useFormRecovery = create<{ request: RecoveryRecord | null }>(
  () => ({ request: null }),
);
