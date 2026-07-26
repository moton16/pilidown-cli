/**
 * pilidown - Unit tests for StreamService
 * Original: tests are original to pilidown.
 */

import { selectVideoStream, selectAudioStream, selectStreams } from '../../src/services/StreamService';
import type { PlayUrlResponse, DashVideo, DashAudio } from '../../src/types/bili';

function v(id: number, codecid: number, bandwidth: number): DashVideo {
  return {
    id,
    baseUrl: `https://v/${id}-${codecid}`,
    baseBackupUrl: [],
    bandwidth,
    mimeType: 'video/mp4',
    codecs: `codec-${codecid}`,
    width: 1920,
    height: 1080,
    frameRate: '60',
    sar: '1:1',
    startWithSap: 0,
    codecid,
  };
}

function a(id: number, bandwidth: number): DashAudio {
  return {
    id,
    baseUrl: `https://a/${id}`,
    baseBackupUrl: [],
    bandwidth,
    mimeType: 'audio/mp4',
    codecs: 'mp4a.40.2',
  };
}

function buildPlayUrl(over: Partial<PlayUrlResponse> = {}): PlayUrlResponse {
  return {
    quality: 80,
    format: 0,
    timelength: 1000,
    accept_quality: [127, 120, 116, 80],
    accept_description: ['8K', '4K', '1080P60', '1080P'],
    support_formats: [],
    dash: {
      duration: 1000,
      minBufferTime: 1.5,
      video: [v(80, 7, 1000), v(80, 12, 2000), v(116, 7, 3000)],
      audio: [a(30216, 100), a(30232, 200)],
    },
    ...over,
  };
}

describe('selectVideoStream', () => {
  test('returns undefined when no dash.video', () => {
    expect(selectVideoStream({ ...buildPlayUrl(), dash: { ...buildPlayUrl().dash, video: [] } })).toBeUndefined();
  });

  test('returns highest bandwidth by default', () => {
    const pick = selectVideoStream(buildPlayUrl());
    expect(pick?.bandwidth).toBe(3000);
    expect(pick?.id).toBe(116);
  });

  test('filters by preferred qn', () => {
    const pick = selectVideoStream(buildPlayUrl(), 80);
    expect(pick?.id).toBe(80);
    // among qn=80 entries, highest bw wins (codecid 12, bw 2000)
    expect(pick?.codecid).toBe(12);
  });

  test('falls back to all when preferred qn unavailable', () => {
    const pick = selectVideoStream(buildPlayUrl(), 999);
    expect(pick?.id).toBe(116);
  });

  test('filters by preferred codec', () => {
    const pick = selectVideoStream(buildPlayUrl(), undefined, 12);
    expect(pick?.codecid).toBe(12);
    expect(pick?.bandwidth).toBe(2000);
  });

  test('combines qn + codec filter', () => {
    const pick = selectVideoStream(buildPlayUrl(), 80, 7);
    expect(pick?.id).toBe(80);
    expect(pick?.codecid).toBe(7);
  });
});

describe('selectAudioStream', () => {
  test('returns highest bandwidth regular audio by default', () => {
    const pick = selectAudioStream(buildPlayUrl());
    expect(pick?.id).toBe(30232);
    expect(pick?.bandwidth).toBe(200);
  });

  test('prefers FLAC (Hi-Res) when available and enabled', () => {
    const flacAudio = a(30251, 999);
    const play = buildPlayUrl();
    play.dash.flac = { display: true, audio: flacAudio };
    const pick = selectAudioStream(play, { preferHiRes: true });
    expect(pick?.id).toBe(30251);
  });

  test('prefers Dolby Atmos when available and enabled', () => {
    const dolbyAudio = a(30250, 1500);
    const play = buildPlayUrl();
    play.dash.dolby = { type: 2, audio: [dolbyAudio] };
    const pick = selectAudioStream(play, { preferDolby: true });
    expect(pick?.id).toBe(30250);
  });

  test('Dolby takes priority over Hi-Res when both enabled', () => {
    const flacAudio = a(30251, 999);
    const dolbyAudio = a(30250, 1500);
    const play = buildPlayUrl();
    play.dash.flac = { display: true, audio: flacAudio };
    play.dash.dolby = { type: 2, audio: [dolbyAudio] };
    const pick = selectAudioStream(play, { preferHiRes: true, preferDolby: true });
    expect(pick?.id).toBe(30250);
  });

  test('returns undefined when no audio at all', () => {
    const play = buildPlayUrl();
    play.dash.audio = [];
    expect(selectAudioStream(play)).toBeUndefined();
  });
});

describe('selectStreams', () => {
  test('aggregates selected video + audio + meta', () => {
    const result = selectStreams(buildPlayUrl(), { preferQn: 80 });
    expect(result.video?.id).toBe(80);
    expect(result.audio?.id).toBe(30232);
    expect(result.quality).toBe(80);
    expect(result.acceptQuality).toEqual([127, 120, 116, 80]);
  });
});
