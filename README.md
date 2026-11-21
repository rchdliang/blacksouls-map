# BLACK SOULS 路线地图

这是玩家制作的《BLACK SOULS》地图导航。迷路时，可以在区域总览中选择地点，或按人物名字定位，再沿图上的路线找到出口、篝火和想见的角色。

解压后双击 `index.html` 即可使用。本项目是静态网页，无需安装依赖。

## 原作与素材来源

- 《BLACK SOULS》由 **イニミニマニモ？**（Eeny, meeny, miny, moe?）制作。地图图块和角色图取自游戏，用于在导航图中辨认地点与人物。图像素材的具体作者见游戏安装目录 `read_me.txt` 的「使用素材」名单。[原作 Steam 页面](https://store.steampowered.com/app/3755860/BLACK_SOULS/)
- 区域总览参考游戏附带的 `地図.png` 重新绘制。原作说明将该图署名为トロ。中文地名、人物名和事件用语沿用游戏汉化，原作所列译者为咕咕熊、LyingSmile、千瓦时kwh、南斗六星阵。
- 本项目根据游戏地图和事件整理地点标注、合并相邻出口，并计算、绘制可走的路线。欢迎下载修改、校正路线或补充标注。

## 修改地图

- `map-data.js` 保存区域顺序、场景、出入口、NPC 位置和回想条件。
- `atlas.js` 管理地图交互、路线计算和 NPC 简名。`atlas.css` 管理样式。
- `tile-layouts.js` 和 `tiles/` 共同组成地图底图。`sprites/` 和 `区域缩略图/` 保存角色图和区域预览。

## 发布与下载

把本目录的内容放在 GitHub 公开仓库根目录，在 Settings → Pages 选择 Deploy from a branch、main 和 /(root)。此后对该分支的修改会自动发布到同一个网页地址。访客可以在侧栏点「下载与修改」进入仓库，通过 Code → Download ZIP 下载，或 Fork 后维护自己的版本。
