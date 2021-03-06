import * as d from '../../declarations';
import { isOutputTargetCustom } from './output-utils';
import { catchError } from '@utils';


export async function outputCustom(config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, docs: d.JsonDocs, outputTargets: d.OutputTarget[]) {
  const customOutputTargets = outputTargets.filter(isOutputTargetCustom);
  if (customOutputTargets.length === 0) {
    return;
  }

  await Promise.all(
    customOutputTargets.map(async o => {
      const timespan = buildCtx.createTimeSpan(`generating ${o.name} started`);
      try {
        await o.generator(config, compilerCtx, buildCtx, docs);
      } catch (e) {
        catchError(buildCtx.diagnostics, e);
      }
      timespan.finish(`generate ${o.name} finished`);
    })
  );
}
