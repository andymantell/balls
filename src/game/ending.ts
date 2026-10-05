import type * as THREE from 'three';
import { EndingView } from '../render/endingView';
import type { App, Screen } from './app';
import { MainMenu } from './mainMenu';

/** State 3: the end of the campaign. ACTION returns to the main menu. */
export class Ending implements Screen {
  private constructor(private app: App, private view: EndingView) {}

  static async create(app: App): Promise<Ending> {
    const view = await EndingView.create(app.textures);
    app.audio.playMusic('menu');
    return new Ending(app, view);
  }

  frame(ticks: number, dtMs: number): void {
    this.view.advance(ticks, dtMs);
    const app = this.app;
    if (app.input.action && !app.loading) {
      app.input.consumeAction();
      app.show(MainMenu.create(app));
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.view.scene, this.view.camera);
  }

  dispose(): void {
    this.view.dispose();
  }
}
