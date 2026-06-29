/** ルートオブジェクト */
type MenuRoot = {
  version: string;        // スキーマバージョン (現在 "1.0")
  menus: TopLevelMenu[];
};

/** メニューバーの各エントリー */
type TopLevelMenu = {
  id: string;             // 識別子 (e.g. "file", "edit")
  label: string;          // 表示名
  mnemonic?: string;      // Alt+キーで開くニーモニック 1文字 (e.g. "F")
  icon?: string;          // Tablerアイコン名 (e.g. "file", "edit") — 接頭辞 "icon-" や "tabler-" は付けない
  items: MenuItem[];
};

/** アイテム共用体 */
type MenuItem =
  | SeparatorItem
  | ActionItem
  | SubmenuItem
  | CheckboxItem
  | RadioItem
  | DynamicItem;

/** 区切り線 */
type SeparatorItem = {
  type: "separator";
};

/** 単純なコマンド */
type ActionItem = {
  type: "action";
  id: string;
  label: string;
  mnemonic?: string;
  shortcut?: string;      // e.g. "Ctrl+N" — 後述の記法参照
  icon?: string;          // Tablerアイコン名 (e.g. "device-floppy") — 接頭辞 "icon-" や "tabler-" は付けない
  enabled?: boolean;      // default: true
};

/** 子メニューを持つアイテム */
type SubmenuItem = {
  type: "submenu";
  id: string;
  label: string;
  mnemonic?: string;
  icon?: string;          // Tablerアイコン名 (e.g. "folder") — 接頭辞 "icon-" や "tabler-" は付けない
  enabled?: boolean;
  items: MenuItem[];      // 空配列 = 現時点で未実装
};

/** チェックマーク付きトグル */
type CheckboxItem = {
  type: "checkbox";
  id: string;
  label: string;
  mnemonic?: string;
  shortcut?: string;
  icon?: string;          // Tablerアイコン名 (e.g. "checkbox") — 接頭辞 "icon-" や "tabler-" は付けない
  checked?: boolean;      // default: false
  enabled?: boolean;
};

/** 排他選択ラジオ (同一 group 内でひとつだけ checked) */
type RadioItem = {
  type: "radio";
  id: string;
  label: string;
  group: string;          // グループ名 (e.g. "controlPointVisibility")
  icon?: string;          // Tablerアイコン名 (e.g. "circle-dot") — 接頭辞 "icon-" や "tabler-" は付けない
  checked?: boolean;      // default: false
  enabled?: boolean;
};

/** 実行時に動的生成されるリスト */
type DynamicItem = {
  type: "dynamic";
  id: string;
  source: string;         // データソースID (e.g. "recentProjects")
  placeholder?: string;   // リストが空のときの表示テキスト
};