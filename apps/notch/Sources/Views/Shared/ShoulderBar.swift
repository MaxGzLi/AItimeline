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

