import { TrayIcon, TrayIconOptions as tio } from "@tauri-apps/api/tray";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { WindowUtils } from "@/lib/window.utils";
import { PhysicalPosition } from "@tauri-apps/api/window";

export interface TrayIconOptions {
  icon?: tio["icon"];
  tooltip?: string;
  action?: tio["action"];
}

export class LocalTrayIds {
  public readonly ids = new Set<string>();
  private readonly key: string = "app-tray-ids";

  // 构造函数，接受一个可选的参数id，可以是字符串或字符串数组
  constructor(id?: string | string[], key?: string) {
    if (key) this.key = key;

    const ids = localStorage.getItem(this.key);
    if (ids) this.ids = new Set(JSON.parse(ids));
    if (id && !Array.isArray(id)) this.ids.add(id);
  }

  add(id: string) {
    this.ids.add(id);
    localStorage.setItem(this.key, JSON.stringify([...this.ids]));
  }

  remove(id: string) {
    this.ids.delete(id);
    localStorage.setItem(this.key, JSON.stringify([...this.ids]));
  }

  clear() {
    this.ids.clear();
    localStorage.removeItem(this.key);
  }

  get items() {
    return [...this.ids];
  }
}

export class AppTray {
  private tray: TrayIcon | null;
  private readonly trayIds = new LocalTrayIds();
  public readonly options: TrayIconOptions | null;

  constructor(options?: TrayIconOptions) {
    this.options = Object.assign({}, options);
    this.tray = null;

    this.clearTrays();

    console.log("[Tray::Main] Getting options", this.options);
  }

  clearTrays() {
    this.trayIds.items.forEach(async (id) => {
      try {
        this.trayIds.remove(id);
        await TrayIcon.removeById(id);
      } catch (e) {
        console.log("[Tray::Clear] Failed to remove tray", e);
      }
    });
  }

  async init() {
    if (this.trayIds.items.length > 0) return;
    this.tray = await TrayIcon.new({
      icon: this.options?.icon ?? (await defaultWindowIcon()) ?? undefined,
      tooltip: this.options?.tooltip,
      showMenuOnLeftClick: false,
      action: async (event) => {
        console.log("[Tray::Action]", event.type, event);
        try {
          if (event.type !== "Click") return;
          const trayWindow = await WindowUtils.getWindowByLabel("tray");
          if (!trayWindow) {
            console.warn("[Tray::Action] tray window not found");
            return;
          }

          const isVisible = await trayWindow.isVisible();
          if (isVisible) {
            await trayWindow.hide();
          } else {
            const { position } = event.rect;
            const trayWinSize = await trayWindow.outerSize();
            const x = Math.round(position.x + event.rect.size.width / 2 - trayWinSize.width / 2);
            const y = Math.round(position.y - trayWinSize.height);

            await trayWindow.setPosition(new PhysicalPosition(x, y));
            await trayWindow.show();
            await trayWindow.setFocus();
          }
        } catch (e) {
          console.error("[Tray::Action] Error:", e);
        }
      },
    });
    if (this.tray) this.trayIds.add(this.tray.id);
    else return;

    console.log("[Tray::Init] New tray", this.tray, this.trayIds.items);
  }

  async quit() {
    await this.tray?.close();
    return this.clearTrays();
  }
}
