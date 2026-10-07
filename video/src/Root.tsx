import React from 'react';
import { Composition } from 'remotion';
import { Promo, PROMO_DURATION } from './Promo';
import { DirectorCut, DIRECTOR_CUT_DURATION } from './DirectorCut';
import {DirectorCutV2, DIRECTOR_CUT_V2_DURATION} from './DirectorCutV2';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={PROMO_DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="DirectorCut"
      component={DirectorCut}
      durationInFrames={DIRECTOR_CUT_DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition id="DirectorCutV2" component={DirectorCutV2} durationInFrames={DIRECTOR_CUT_V2_DURATION} fps={30} width={1920} height={1080}/>
  </>
);
