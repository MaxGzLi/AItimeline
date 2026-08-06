import SwiftUI

/// 切面的那一排图标。两处在用,大小不同、位置不同,但**顺序永远一样**:
/// 四个面固定四个位置,当前那个高亮。位置会动的导航等于没有导航 ——
/// 用户记不住「日程在第几个」,每次都得重新找。
///
/// - `FaceTabs`:半屏面板的左肩,28×22。
/// - `FaceStrip`:悬停小条内容行的右端,22×22。
struct FaceTabs: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        HStack(spacing: 6) {
            ForEach(NotchFace.available) { face in
                FaceTab(face: face, selected: appState.selectedFace == face) {
                    appState.select(face)
                }
            }

            Spacer(minLength: 0)
        }
    }
}

/// 悬停这一档也能直接切面。
///
/// **原版没有这个。** SuperIsland 在悬停档只能靠落水槽里的左右箭头一个一个翻模块,
/// 从知识跳到日程要按三下;真想直接去某一个,得先点开半屏面板。
/// 用户的原话是「还得点进去才能切换是很差的用户体验」,所以这里比原版多一排按钮。
///
/// **位置为什么在内容行右端,不在肩栏里**:小条 408 宽,肩栏两边各留 20,
/// 中间还要让开刘海那 203 点,两翼各自只剩 82 —— 四个按钮怎么排都塞不下,
/// 硬塞就会有一截压在刘海底下(那块屏幕物理上不显示,等于按钮丢了一个)。
/// 内容行没有刘海挡着,340 全是能用的。
struct FaceStrip: View {
    @EnvironmentObject private var appState: AppState

    /// 五个 22 加四个 2 = 118。剩下 162 留给正文,两行 13 号字大约二十四个汉字 ——
    /// 够放一句结论,但**再加一个面就不够了**。第六个面要么换成横滚,要么就得砍掉一个。
    static let width: CGFloat = 118

    var body: some View {
        HStack(spacing: 2) {
            ForEach(NotchFace.available) { face in
                FaceTab(
                    face: face,
                    selected: appState.selectedFace == face,
                    width: 22,
                    height: 22,
                    glyph: 10
                ) {
                    appState.select(face)
                }
            }
        }
        .frame(width: Self.width, alignment: .trailing)
    }
}

struct FaceTab: View {
    let face: NotchFace
    let selected: Bool
    var width: CGFloat = 28
    var height: CGFloat = 22
    var glyph: CGFloat = 11
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: face.symbol)
                .font(.system(size: glyph, weight: .medium))
                .foregroundStyle(.white.opacity(selected ? 0.92 : hovering ? 0.62 : 0.38))
                .frame(width: width, height: height)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(.white.opacity(selected ? 0.10 : hovering ? 0.05 : 0))
                )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.18), value: hovering)
        .animation(.easeOut(duration: 0.18), value: selected)
        .help(face.title)
        .hoverPointer()
    }
}
