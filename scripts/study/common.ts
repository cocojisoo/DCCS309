// 실험 스크립트 공통: 설정과 지도 불러오기, 경로 상수
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StudyConfig } from "../../src/lib/study/benchmark.ts";
import { studyGraphFromJson, type StudyGraph, type StudyGraphJson } from "../../src/lib/study/graph.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RESULTS = path.join(ROOT, "results");
export const RAW_CSV = path.join(RESULTS, "raw_runs.csv");
export const SUMMARY_CSV = path.join(RESULTS, "summary.csv");
export const META_JSON = path.join(RESULTS, "study_meta.json");
export const PUBLIC_STUDY = path.join(ROOT, "public", "study");

export function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function loadConfig(): StudyConfig {
  const file = path.resolve(ROOT, argValue("--config", "configs/study.json"));
  // 윈도우 편집기가 붙이는 BOM 은 떼고 읽는다
  return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
}

export function loadBase(): { json: StudyGraphJson; base: StudyGraph } {
  const file = path.join(ROOT, "public", "graph", "study.json");
  let json: StudyGraphJson;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("public/graph/study.json 이 없습니다. 먼저 npm run study:graph 를 실행하세요.");
  }
  return { json, base: studyGraphFromJson(json) };
}

export const rel = (p: string) => path.relative(ROOT, p);
