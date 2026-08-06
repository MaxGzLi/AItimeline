import SwiftUI

/// 半屏面板:面板 900×520。
///
/// 版面账:37(肩栏)+ 12 + 430(面)+ 41(底通栏)= 520。
/// 肩栏左翼是切面的图标,右翼是**当前这个面自己的**元信息 ——
/// 面与面的骨架完全一样,只有内容不同,切面的时候窗口边缘一动不动。
struct FullExpandedView: View {
    @EnvironmentObject private var appState: AppState

    private let sidePadding = Constants.fullExpandedSidePadding

    var body: some View {
        VStack(spacing: 0) {
            if appState.contentTopInset > 0 {
                ShoulderBar(sidePadding: Constants.fullExpandedSidePadding, trailingWidth: 240) {
                    FaceTabs()
                } trailing: {
                    trailing
                }
            } else {
                // 没刘海的屏:带子高度是 0,肩栏退化成内容上方的一整行。
                HStack(spacing: 12) {
                    FaceTabs()
                    Spacer(minLength: 12)
                    trailing
                }
                .frame(height: 22)
                .padding(.horizontal, sidePadding)
                .padding(.top, 8)
            }

            face
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    @ViewBuilder
    private var face: some View {
        switch appState.selectedFace {
        case .cards:
            CardsFace()
        case .shelf:
            ShelfFace()
        case .focus:
            FocusFace()
        case .agenda:
            AgendaFace()
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch appState.selectedFace {
        case .cards:
            CardsShoulderTrailing()
        case .shelf:
            ShelfShoulderTrailing()
        case .focus:
            FocusShoulderTrailing()
        case .agenda:
            AgendaShoulderTrailing()
        }
    }
}
