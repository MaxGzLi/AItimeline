# AITimeline 刘海应用

macOS 刘海里的知识回流面。三档:

- **静默条** —— 贴在刘海两侧,一个图标加一个数字。数字是该复习的卡数(没有到期的就显示总数)。
- **小条**(悬停 0.3 秒)—— 一张卡的出处、标题、第几张。
- **半屏面板**(点一下)—— 一张卡从头读到尾,装不下就往下滚。

数据来自本机 `127.0.0.1:8787/api/inject/cards`,不外发。接口挂掉时保留上一批卡,
只把图标换成警告三角 —— 知识卡不会一分钟就过期,拿旧的看比空着强。

## 构建和运行

```bash
brew install xcodegen          # 只需一次
cd apps/notch
xcodegen                       # 从 project.yml 生成 .xcodeproj
xcodebuild -scheme AITimelineNotch -configuration Release -derivedDataPath build build
open build/Build/Products/Release/AITimelineNotch.app
```

退出:菜单栏那个书本图标 → 退出。

## 三条必须知道的

**一、刘海里面画的东西肉眼看不见。** 刘海那块屏幕物理上不显示,但截图会把它当普通像素抓下来 ——
所以「截图里看得见」不等于「用户看得见」。静默条的图标和数字必须落在刘海**两侧**伸出来的那两截上
(`Constants.compactSideExpansion`),中间那段留给刘海本身。这是照着截图核对出来的,不是想当然。

**二、第一下点击会被系统吃掉。** 刘海面板是不抢焦点的窗口,不重写 `acceptsFirstMouse`
的话,第一次点击只用来切焦点、不传给视图,用户得点两下。见 `FirstClickHostingView`。

**三、鼠标进出事件会漏。** 窗口尺寸刚变过、指针从别的空间切回来、指针一步跳到远处,
都可能只收到「进」收不到「出」,面板就永远以为鼠标还在上面,不自动收起。所以每半秒
拿真实指针位置校对一次(`AppState.startHoverAudit`)。

## 手感是抄来的

尺寸、圆角、弹簧参数抄自 SuperIsland(见 `Sources/Core/Constants.swift` 里的注释)。
用户的要求是「效果和它一模一样」,手感就藏在这些数里,改任何一个都会偏。

形状那部分(`PillShape`)的关键是**顶部两角往外拐**:面板顶边贴着屏幕最上沿,
两侧的墙往下走之前先向外弯出去,和菜单栏那条黑边连成一体。普通圆角矩形做不出这个,
那样面板看着是浮在屏幕上的一块,而不是刘海长出来的。
