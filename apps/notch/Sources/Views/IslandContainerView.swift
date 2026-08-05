import SwiftUI

/// 刘海面板本体:一块黑色的形状,里面按状态换内容。
///
/// 窗口比面板大一圈(留白和阴影),多出来的地方是完全透明的 —— 透明处不接鼠标,
/// 底下的东西照样点得到。所以这里**不能**给外层加背景色,哪怕透明度是 0。
struct IslandContainerView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared

    var body: some View {
        ZStack(alignment: .top) {
            surface

            // 翻页钮放在面板外面那两条空槽里。收起时必须从视图树里拿掉,
            // 只设透明度的话那 24×24 会挡住底下应用的点击。
            if appState.currentState == .fullExpanded, store.cards.count > 1 {
                gutterButtons
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var surface: some View {
        let size = appState.currentSize
        let compact = appState.currentState == .compact

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

            if !compact, appState.hasNotch {
                NotchSeam(notchSize: appState.notchSize)
            }

            content
                .frame(width: size.width, height: size.height, alignment: .top)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(shape)
        .compositingGroup()
        // 静默条不打阴影。它靠贴住屏幕顶边成立,底下垫一层模糊反而露馅。
        .shadow(color: .black.opacity(compact ? 0 : 0.28), radius: compact ? 0 : 18, y: compact ? 0 : 8)
        .shadow(color: .black.opacity(compact ? 0 : 0.16), radius: compact ? 0 : 3, y: compact ? 0 : 1)
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
                .transition(.opacity)
        case .fullExpanded:
            FullExpandedView()
                .transition(.opacity)
        }
    }

    private var gutterButtons: some View {
        HStack(spacing: 0) {
            GutterButton(symbol: "chevron.left") { store.previous() }
            Spacer()
            GutterButton(symbol: "chevron.right") { store.next() }
        }
        .padding(.horizontal, (Constants.gutterWidth - GutterButton.size) / 2)
        .padding(.top, appState.currentSize.height / 2 - GutterButton.size / 2)
    }
}

/// 面板外空槽里的翻页钮。常态就看得见(0.72),不做成悬停才出现的隐藏工具条 ——
/// 藏起来的操作等于不存在。
private struct GutterButton: View {
    static let size: CGFloat = 24

    let symbol: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(.black.opacity(hovering ? 0.90 : 0.80))
                    .overlay(Circle().stroke(.white.opacity(0.12), lineWidth: 1))
                    .shadow(color: .black.opacity(0.30), radius: 4, y: 2)

                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white.opacity(0.90))
            }
            .frame(width: Self.size, height: Self.size)
            .opacity(hovering ? 1.0 : 0.72)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.18), value: hovering)
        .hoverPointer()
    }
}
