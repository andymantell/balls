import { App } from './game/app';
import { MainMenu } from './game/mainMenu';
import { LevelSession } from './game/session';
import { MAPS } from './game/maps';
import { Ending } from './game/ending';

async function main(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const app = new App(canvas);
  await app.init();

  // ?map=<name> jumps straight into a level; ?replay=<name> plays its best-time replay.
  const params = new URLSearchParams(location.search);
  app.touchMode = params.has('touch') || window.matchMedia('(pointer: coarse)').matches;
  const map = params.get('map');
  const replay = params.get('replay');
  const rec = replay && MAPS.includes(replay) ? await app.records.get(replay) : null;
  if (params.has('ending')) app.show(Ending.create(app));
  else if (replay && rec?.replay) app.show(LevelSession.create(app, { slug: replay, playback: rec.replay }));
  else if (map && MAPS.includes(map)) app.show(LevelSession.create(app, { slug: map }));
  else app.show(MainMenu.create(app));
  app.start();

  // On-screen controls for touch devices only; desktop never loads this module.
  if (app.touchMode) {
    void import('./mobile/touchControls').then((m) => m.installTouchControls(app));
  }

  // Custom levels: drop a MAKEMAP .3do (plus its .bmp/.png textures) on the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    const level = files.find((f) => /\.3do$/i.test(f.name));
    for (const f of files) {
      if (/\.(bmp|png|jpe?g)$/i.test(f.name)) app.textures.extra.set(f.name.replace(/\.[^.]*$/, '').toLowerCase(), f);
    }
    if (!level) return;
    const slug = `custom:${level.name.replace(/\.[^.]*$/, '').toLowerCase()}`;
    void level.arrayBuffer().then((file) => app.show(LevelSession.create(app, { slug, file })));
  });

  const hint = document.getElementById('hint');
  if (hint) {
    const hide = () => hint.classList.add('hidden');
    window.addEventListener('keydown', hide, { once: true });
    window.addEventListener('pointerdown', hide, { once: true });
  }
  (window as unknown as { balls: App }).balls = app;
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="error">${String(e?.stack ?? e)}</pre>`);
});
