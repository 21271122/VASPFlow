import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setCrf(12);
Config.setGopSize(30);
Config.setPixelFormat('yuv420p');
Config.setConcurrency(1);
