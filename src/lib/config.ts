export type Mode = "car" | "walk";

export interface Place {
  name: string;
  lat: number;
  lng: number;
}

// 좌표 출처: OpenStreetMap
//  - 출발: "공공자전거 어울링 대여소_고려대학교 정문" 노드 (정문 바로 앞)
//  - 도착: "조치원역 후문" (railway=train_station_entrance, 역 서쪽)
export const START: Place = { name: "고려대학교 세종캠퍼스 정문", lat: 36.6086266, lng: 127.2892431 };
export const END: Place = { name: "조치원역 후문", lat: 36.6010014, lng: 127.2952359 };

export const SPEED_KMH: Record<Mode, number> = { car: 30, walk: 4.8 };
export const speedMps = (mode: Mode) => (SPEED_KMH[mode] * 1000) / 3600;

/** 현실 보정 옵션: 자동차는 교차로 통과마다, 도보는 횡단보도 1회 건널 때마다 추가되는 시간(초) */
export const PENALTY_SEC = { intersection: 20, crossing: 60 };

export const MODE_LABEL: Record<Mode, string> = { car: "자동차 (차도)", walk: "도보 (인도)" };
