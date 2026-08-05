import SwiftUI

/// 静默态:贴着刘海的一条,左边一个图标,右边一个数字。
/// 刘海本身遮住中间,所以内容必须靠两边排,中间留空。
struct CompactView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared

    var body: some View {
        HStack(spacing: 0) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(iconColor)
                .frame(width: Constants.compactSideExpansion)

            // 中间让给刘海。这一段屏幕物理上不显示,画什么都白画。
            Spacer(minLength: appState.compactMetrics?.notchGap ?? 0)

            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(labelColor)
                .frame(width: Constants.compactSideExpansion)
        }
        .frame(maxHeight: .infinity)
    }

    private var icon: String {
        if store.isOffline { return "exclamationmark.triangle" }

        return store.dueCount > 0 ? "book" : "book.closed"
    }

    private var iconColor: Color {
        if store.isOffline { return .orange.opacity(0.85) }

        return store.dueCount > 0 ? .white.opacity(0.9) : .white.opacity(0.45)
    }

    private var label: String {
        guard store.hasLoadedOnce else { return "…" }
        guard !store.cards.isEmpty else { return "" }

        return store.dueCount > 0 ? "\(store.dueCount)" : "\(store.cards.count)"
    }

    private var labelColor: Color {
        store.dueCount > 0 ? .white.opacity(0.9) : .white.opacity(0.45)
    }
}
