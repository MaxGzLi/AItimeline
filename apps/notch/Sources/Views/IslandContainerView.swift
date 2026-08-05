import SwiftUI

/// 刘海面板本体:一块黑色的形状,里面按状态换内容。
///
/// 窗口比面板大一圈(留白和阴影),多出来的地方是完全透明的 —— 透明处不接鼠标,
/// 底下的东西照样点得到。所以这里**不能**给外层加背景色,哪怕透明度是 0。
struct IslandContainerView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        ZStack(alignment: .top) {
            surface
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var surface: some View {
        let size = appState.currentSize

        return ZStack(alignment: .top) {
            // 不透明。SuperIsland 那边是 0.98/0.94,它的面板小、基本盖在菜单栏那条黑边上,
            // 看不出来;我们这块有半个屏幕大,底下窗口的白字会以 6% 透上来,一片灰影,
            // 读字的时候很扎眼。所以只保留上下的明暗过渡,不留透明度。
            shape.fill(
                LinearGradient(
                    colors: [.black, Color(white: 0.045)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )

            content
                .frame(width: size.width, height: size.height, alignment: .top)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(shape)
        .compositingGroup()
        .shadow(color: .black.opacity(0.28), radius: 18, y: 8)
        .shadow(color: .black.opacity(0.16), radius: 3, y: 1)
        .contentShape(shape)
        .onContinuousHover { phase in
            switch phase {
            case .active:
                appState.isHovering = true
            case .ended:
                appState.isHovering = false
            }
        }
        .onTapGesture {
            appState.handleTap()
        }
    }

    private var shape: PillShape {
        PillShape(
            topLeadingRadius: appState.topCornerRadius,
            topTrailingRadius: appState.topCornerRadius,
            bottomLeadingRadius: appState.bottomCornerRadius,
            bottomTrailingRadius: appState.bottomCornerRadius,
            outwardTopCorners: true
        )
    }

    @ViewBuilder
    private var content: some View {
        switch appState.currentState {
        case .compact:
            CompactView()
                .transition(.opacity.combined(with: .scale(scale: 0.85)))
        case .expanded:
            ExpandedView()
                .padding(.top, appState.contentTopInset)
                .transition(.opacity)
        case .fullExpanded:
            FullExpandedView()
                .padding(.top, appState.contentTopInset)
                .transition(.opacity)
        }
    }
}
