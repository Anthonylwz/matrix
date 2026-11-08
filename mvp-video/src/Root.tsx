import {Composition} from 'remotion';
import {MVP} from './MVP';
// 11.8 s @ 30 fps. Render with --scale=2 for 4K (2160x3840 / 3840x2160).
const D = 354;
export const Root = () => (
  <>
    <Composition id="MVPVertical" component={MVP} durationInFrames={D} fps={30} width={1080} height={1920} />
    <Composition id="MVPHorizontal" component={MVP} durationInFrames={D} fps={30} width={1920} height={1080} />
  </>
);
