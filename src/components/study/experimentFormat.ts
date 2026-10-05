import { formatMs } from "@/lib/format";

/** 브라우저 타이머가 0을 반환해도 계산이 무료였다는 뜻은 아니다. */
export const formatExperimentMs = (ms: number) => ms === 0 ? "측정 해상도 미만" : formatMs(ms);
