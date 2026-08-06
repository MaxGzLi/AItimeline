# 改过的 SuperIsland(过渡用)

补丁里有两处改动:**面板尺寸插件可以声明**(下面详述),和**悬停只开小条**。

后者是因为:宿主默认鼠标在刘海停 0.3 秒就展开,而且挂着插件模块时是直接跳到最大那一档。
手伸向菜单栏、切标签页、把窗口拖到顶,一天要蹭过去几十次 —— 面板放大到半屏之后,
每次误蹭都掉下来半个屏幕,像是刘海自己在乱跳。改成悬停出小条(408×88),
半屏面板要点一下才出来。改动 1 行,点开的通路本来就有(`handleSurfaceTap`)。

**这份是过渡方案。** 已经拍板要自己写刘海宿主,见
`docs/specs/2026-08-05-own-notch-host.md`。

---

## 让 SuperIsland 认我们声明的面板尺寸

刘海面板默认是 **658×180**,扣掉左右内衬和上下留白,插件只剩 594×172 —— 大约五六行
正文。一张知识卡(概要 + 五段 thread,中位 614 字)得切成七页翻着读,这不是「中长段
读着舒服」。

宿主 [SuperIsland](https://github.com/shobhit99/SuperIsland) 是开源的,所以这里改宿主:
manifest 里多两个字段,宿主读到就按这个尺寸开窗。

```json
"capabilities": {
  "fullExpanded": true,
  "fullExpandedWidth": 900,
  "fullExpandedHeight": 520
}
```

改完之后本机实测:岛窗 **1004×597**,插件可用画布 **836×512**;同一张卡从 7 页降到
1~2 页,多数卡一页读完。

## 为什么是这么改的

宿主里 `fullExpanded` 这个词出现在 21 个文件里 146 处,**加一个新的 IslandState 枚举
分支要动的地方太多**;而尺寸本来就是从 `Constants.swift` 里读一个常数,换成「插件声明
了就用插件的」只要三十来行,没声明的插件走原来的常数,官方那七个扩展一行都不用改。

尺寸会按屏幕夹一次(减去窗口自己的边距),所以插件写多大都撑不出屏幕。

## 怎么构建

```bash
git clone https://github.com/shobhit99/SuperIsland.git
cd SuperIsland
git checkout 5619541                     # 打补丁时的版本,换版本要重新对一遍
git apply /path/to/apps/notch-extension/host/superisland-aitimeline.patch
brew install xcodegen && xcodegen         # 仓库用 XcodeGen 生成 .xcodeproj
xcodebuild -scheme SuperIsland -configuration Release build
```

产物在 `~/Library/Developer/Xcode/DerivedData/SuperIsland-*/Build/Products/Release/`。
先退出官方版再启动这一份。

## 三件必须先说清楚的事

1. **自己构建的版本没有签名**,等于放弃了官方签名版和自动更新。首次启动要在
   「系统设置 → 隐私与安全性」里放行。
2. **那个仓库没有 LICENSE 文件**,法律上默认「保留所有权利」。自己改着自己用没问题,
   但不能分发,也不能让 AITimeline 的用户「先去装我们改过的 SuperIsland」。
   要真走这条路,得先问作者要授权,或者把这个改动作为 PR 提上去让它进官方版。
3. 官方版和这份改版**共用同一个扩展目录和配置**,两个一起跑会打架,只留一个。
