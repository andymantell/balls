import { App } from './game/app';
import { MainMenu } from './game/mainMenu';
import { LevelSession } from './game/session';
import { MAPS } from './game/maps';

async function main(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const app = new App(canvas);
  await app.init();

  // ?map=<name> jumps straight into a level (handy for testing levels).
  const params = new URLSearchParams(location.search);
  const map = params.get('map');
  if (map && MAPS.includes(map)) app.show(LevelSession.create(app, { slug: map }));
  else app.show(MainMenu.create(app));
  app.start();

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
