//! 音频：symphonia 解码 → 48kHz 立体声 f32；按帧混音（关键帧音量 + 淡入淡出包络）。

use crate::timeline::SceneDescriptor;
use std::collections::HashMap;
use std::path::Path;

pub const TARGET_RATE: u32 = 48_000;
pub const TARGET_CHANNELS: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("打开音频文件失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("音频解析失败: {0}")]
    Symphonia(String),
    #[error("没有可解码的音轨")]
    NoTracks,
}

/// 解码结果：48kHz 立体声（f32，归一化 -1..1）。
#[derive(Clone, Debug)]
pub struct DecodedAudio {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
    pub source_rate: u32,
    pub duration_ms: u64,
}

pub fn decode_audio_file(path: &Path) -> Result<DecodedAudio, AudioError> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let hint = Hint::new();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| AudioError::Symphonia(format!("probe: {e}")))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or(AudioError::NoTracks)?
        .clone();
    let track_id = track.id;
    let source_rate = track.codec_params.sample_rate.ok_or_else(|| AudioError::Symphonia("缺少采样率".into()))?;
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AudioError::Symphonia(format!("codec: {e}")))?;

    let mut raw: Vec<f32> = Vec::new(); // 交错（源通道数）
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                // 统一转 f32 交错样本（SampleBuffer 处理任意采样格式与通道布局）
                let spec = *decoded.spec();
                let frames = decoded.capacity();
                let mut sb = SampleBuffer::<f32>::new(frames as u64, spec);
                sb.copy_interleaved_ref(decoded);
                raw.extend_from_slice(sb.samples());
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    if raw.is_empty() {
        return Ok(DecodedAudio {
            l: Vec::new(),
            r: Vec::new(),
            source_rate,
            duration_ms: 0,
        });
    }

    let (l, r) = to_stereo_48k(&raw, source_rate, channels.max(1));
    let duration_ms = (l.len() as u64 * 1000) / TARGET_RATE as u64;
    Ok(DecodedAudio {
        l,
        r,
        source_rate,
        duration_ms,
    })
}

/// 下混到立体声 + 线性重采样到 48kHz。
fn to_stereo_48k(raw: &[f32], src_rate: u32, src_channels: usize) -> (Vec<f32>, Vec<f32>) {
    let frames = raw.len() / src_channels;
    if frames == 0 {
        return (Vec::new(), Vec::new());
    }
    let out_frames = ((frames as f64) * TARGET_RATE as f64 / src_rate as f64).ceil() as usize;
    let mut l = Vec::with_capacity(out_frames);
    let mut r = Vec::with_capacity(out_frames);
    let ratio = TARGET_RATE as f64 / src_rate as f64;
    for i in 0..out_frames {
        let pos = i as f64 / ratio;
        let i0 = pos.floor() as usize;
        let frac = pos - i0 as f64;
        let i1 = (i0 + 1).min(frames - 1);
        let (l0, r0) = sample_stereo(raw, src_channels, i0);
        let (l1, r1) = sample_stereo(raw, src_channels, i1);
        l.push(l0 + (l1 - l0) * frac as f32);
        r.push(r0 + (r1 - r0) * frac as f32);
    }
    (l, r)
}

fn sample_stereo(raw: &[f32], channels: usize, frame: usize) -> (f32, f32) {
    let base = frame * channels;
    if channels == 1 {
        let s = raw[base];
        (s, s)
    } else if channels == 2 {
        (raw[base], raw[base + 1])
    } else {
        // 多通道：取前两通道（简化下混）
        (raw[base], raw[base + 1])
    }
}

/// 顺序混音器：按帧把 SceneDescriptor.audio 累加进输出缓冲（交错立体声 48k）。
pub struct AudioMixer {
    audios: HashMap<String, DecodedAudio>,
    out: Vec<f32>,
    fps: u32,
}

impl AudioMixer {
    pub fn new(audios: HashMap<String, DecodedAudio>, fps: u32, total_frames: u32) -> Self {
        let total_samples = (total_frames as u64 * TARGET_RATE as u64 / fps as u64) as usize;
        AudioMixer {
            audios,
            out: vec![0.0; total_samples * TARGET_CHANNELS],
            fps: fps.max(1),
        }
    }

    /// 累加一帧的音频（帧号与混音帧一致）。
    pub fn add_frame(&mut self, desc: &SceneDescriptor, frame: u32) {
        let sr = TARGET_RATE as u64;
        let fps = self.fps as u64;
        let chunk_start = (frame as u64 * sr) / fps;
        let chunk_end = (((frame as u64 + 1) * sr) / fps).min(self.out.len() as u64 / 2);
        if chunk_start >= chunk_end {
            return;
        }
        for a in &desc.audio {
            let Some(src) = self.audios.get(&a.asset_id) else {
                continue;
            };
            let vol = a.volume.clamp(0.0, 1.0) as f32;
            if vol <= 0.0 {
                continue;
            }
            // 片段内起点（采样）
            let clip_start_sample = (a.start_frame as u64 * sr) / fps;
            let clip_samples = (a.duration_frames as u64 * sr) / fps;
            for g in chunk_start..chunk_end {
                let local = g as i64 - clip_start_sample as i64;
                if local < 0 || local as u64 >= clip_samples {
                    continue;
                }
                let li = local as usize;
                let lv = src.l.get(li).copied().unwrap_or(0.0);
                let rv = src.r.get(li).copied().unwrap_or(0.0);
                let o = (g * 2) as usize;
                self.out[o] += lv * vol;
                self.out[o + 1] += rv * vol;
            }
        }
    }

    /// 写为 16bit 有符号交错 PCM（s16le）。
    pub fn write_s16le(&self, path: &Path) -> std::io::Result<()> {
        let mut buf: Vec<u8> = Vec::with_capacity(self.out.len() * 2);
        for &s in &self.out {
            let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
            buf.extend_from_slice(&v.to_le_bytes());
        }
        std::fs::write(path, buf)
    }

    pub fn len(&self) -> usize {
        self.out.len() / TARGET_CHANNELS
    }

    pub fn is_silent(&self) -> bool {
        self.out.iter().all(|&s| s.abs() < 1e-6)
    }
}

/// 预加载音频素材（assetId → 解码数据）。缺失素材静默跳过。
pub fn load_audios(project: &crate::model::Project, project_dir: &Path) -> HashMap<String, DecodedAudio> {
    let mut out = HashMap::new();
    for asset in &project.assets {
        if asset.kind != crate::model::AssetKind::Audio {
            continue;
        }
        let path = project_dir.join("assets").join(&asset.file_name);
        if let Ok(a) = decode_audio_file(&path) {
            out.insert(asset.id.clone(), a);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::create_demo;

    #[test]
    fn decode_demo_bgm_produces_signal() {
        let dir = std::env::temp_dir().join(format!("sf-audio-dbg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let result = create_demo(&dir).unwrap();
        let path = dir.join("assets").join("demo-bgm.wav");
        let decoded = decode_audio_file(&path).expect("解码 demo-bgm.wav");
        assert!(decoded.duration_ms > 0, "时长应为正: {}", decoded.duration_ms);
        // 220Hz 正弦应有实际信号
        let peak = decoded
            .l
            .iter()
            .chain(decoded.r.iter())
            .map(|s| s.abs())
            .fold(0.0_f32, |a, b| a.max(b));
        assert!(peak > 0.05, "峰值过低: {peak}");
        // 混音器输出同样应有信号
        let mut audios = HashMap::new();
        audios.insert("ast_bgm".to_string(), decoded);
        let mut mixer = AudioMixer::new(audios, 30, 360);
        let project = result.project;
        let path2 = crate::graph::linearize_default_path(&project.script);
        for frame in 0..360 {
            let desc = crate::graph::evaluate(&project, &path2, frame);
            mixer.add_frame(&desc, frame);
        }
        let peak_out = mixer
            .out
            .iter()
            .map(|s| s.abs())
            .fold(0.0_f32, |a, b| a.max(b));
        assert!(peak_out > 0.01, "混音输出峰值过低: {peak_out}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
