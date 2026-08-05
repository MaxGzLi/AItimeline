import SwiftUI

/// 悬停出来的小条:一眼看清「有什么、要不要点开」。
struct ExpandedView: View {
    @ObservedObject private var store = CardStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let card = store.current {
                HStack(spacing: 6) {
                    if card.isReviewDue {
                        Text("该复习了")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Color(red: 1, green: 0.72, blue: 0.2), in: RoundedRectangle(cornerRadius: 3))
                    }

                    Text(card.sourceTitle ?? "")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.4))
                        .lineLimit(1)

                    Spacer(minLength: 0)

                    Text("\(store.index + 1)/\(store.cards.count)")
                        .font(.system(size: 10))
                        .foregroundStyle(.white.opacity(0.4))
                }

                Text(card.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            } else {
                Text(placeholder)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var placeholder: String {
        if !store.hasLoadedOnce { return "正在读知识库…" }
        if store.isOffline { return "本机 AITimeline 没有运行" }

        return "知识库里还没有该回来的卡"
    }
}
