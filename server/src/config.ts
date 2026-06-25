import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));

export const config = {
  port: parseInt(process.env.PORT || '3031', 10),
  dataDir,
  videosDir: path.join(dataDir, 'videos'),
  thumbsDir: path.join(dataDir, 'thumbs'),
  cookiesFile: path.join(dataDir, 'cookies.txt'),
  ytdlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  ffmpegPath: (process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg') as string,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientDistDir: path.join(__dirname, '..', '..', 'client', 'dist'),
};
