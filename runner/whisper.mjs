// 소리를 받아 적어요 (Whisper, @huggingface/transformers). 실행기가 따로 띄우는 작은 프로그램이에요.
// 쓰는 법: node whisper.mjs <모듈 폴더> <모델 폴더> <모델 이름> <16kHz mono f32le 파일> <결과 json> <언어: korean|english|...>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [modDir, cacheDir, model, raw, outFile, language] = process.argv.slice(2);
const T = await import(pathToFileURL(path.join(modDir, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs')).href);
T.env.cacheDir = cacheDir;
T.env.allowLocalModels = false;
const asr = await T.pipeline('automatic-speech-recognition', model, {
  dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  progress_callback: p => { if (p.status === 'progress' && p.total > 5e7) process.stdout.write(`PROGRESS ${p.file} ${Math.round(p.progress)}\n`); },
});
const b = fs.readFileSync(raw), audio = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
const r = await asr(audio, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...(language ? { language } : {}) });
const chunks = (r.chunks || []).map(c => ({ s: c.timestamp[0] ?? 0, e: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2, t: String(c.text || '').trim() })).filter(c => c.t);
fs.writeFileSync(outFile, JSON.stringify({ text: r.text || '', chunks }));
process.stdout.write('DONE\n');
