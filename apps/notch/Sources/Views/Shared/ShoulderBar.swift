import SwiftUI

/// 让开刘海的那条带子:左右两翼夹着刘海,中间那段净空一个像素都不许放东西。
///
/// 两翼宽度**一律按公式算**:中间净空 = 刘海宽 + 20,右翼定死像素,左翼取剩下的。
/// 写死两翼像素的话,换一台刘海宽度不同的机器就会撞上刘海。
/// 没有刘海的屏上这条带子高度是 0,内容由各个面自己排成一行(见各面的 flat 分支)。
struct ShoulderBar<Leading: View, Trailing: View>: View {
    @EnvironmentObject private var appState: AppState

    let sidePadding: CGFloat
    let trailingWidth: CGFloat
    @ViewBuilder let leading: () -> Leading
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        let available = appState.currentSize.width - sidePadding * 2
        let gap = appState.shoulderGap
        let trailingSlot = min(trailingWidth, max(0, available - gap))
        let leadingSlot = max(0, available - gap - trailingSlot)

        HStack(spacing: 0) {
            leading()
                .frame(width: leadingSlot, alignment: .leading)

            Spacer(minLength: gap)

            trailing()
                .frame(width: trailingSlot, alignment: .trailing)
        }
        .padding(.horizontal, sidePadding)
        .frame(height: appState.contentTopInset)
        .clipped()
    }
}

/// 肩上那排切面的图标。原版是 36 见方、间距 8;我们只有四个面,不用横滚。
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

private struct FaceTab: View {
    let face: NotchFace
    let selected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: face.symbol)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(selected ? 0.92 : hovering ? 0.62 : 0.38))
                .frame(width: 28, height: 22)
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
