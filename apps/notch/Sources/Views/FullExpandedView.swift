import AppKit
import SwiftUI

/// 半屏阅读面板:一张卡从头读到尾。
///
/// 这里**不分页**。之前在别人的宿主上必须自己算分页,是因为那套接口只能给一棵
/// 固定高度的视图树,滚不动。原生就没这个限制:装不下就往下滚,一张卡是连续的一篇。
struct FullExpandedView: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var store = CardStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let card = store.current {
                masthead(card)
                Divider().overlay(Color.white.opacity(0.12))

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 10) {
                        headline(card)
                        body(card)
                        sections(card)
                        concepts(card)
                    }
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                Divider().overlay(Color.white.opacity(0.12))
                footer(card)
            } else {
                Spacer()
                Text(placeholder)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))
                    .frame(maxWidth: .infinity)
                Spacer()
            }
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: - 报头

    private func masthead(_ card: Card) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color(red: 1, green: 0.72, blue: 0.2))
                .frame(width: 6, height: 6)

            if card.isReviewDue {
                Text("该复习了")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Color(red: 1, green: 0.72, blue: 0.2), in: RoundedRectangle(cornerRadius: 3))
            }

            Text(card.sourceTitle ?? "")
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.42))
                .lineLimit(1)

            Spacer(minLength: 12)

            if let minutes = card.estimatedReadMinutes {
                Text("\(minutes) 分钟")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.42))
            }

            Text("\(store.index + 1)/\(store.cards.count)")
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.42))
        }
        .padding(.bottom, 6)
    }

    // MARK: - 大标题和导语

    private func headline(_ card: Card) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(card.title)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)

            if let takeaway = card.keyTakeaway, !takeaway.isEmpty {
                Text(takeaway)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func body(_ card: Card) -> some View {
        let text = card.shortBody?.isEmpty == false ? card.shortBody! : card.summary

        if !text.isEmpty {
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.66))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func sections(_ card: Card) -> some View {
        ForEach(Array(card.sections.enumerated()), id: \.offset) { _, section in
            VStack(alignment: .leading, spacing: 3) {
                if !section.title.isEmpty {
                    Text(section.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.92))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(section.body)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.66))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func concepts(_ card: Card) -> some View {
        if !card.conceptIds.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("相关概念 \(card.conceptIds.count) 个")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.34))

                Text(card.conceptIds.joined(separator: "  ·  "))
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.66))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 2)
        }
    }

    // MARK: - 底通栏

    private func footer(_ card: Card) -> some View {
        HStack(spacing: 14) {
            if let prompt = card.reviewPrompt, card.isReviewDue {
                Text("问")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 1, green: 0.72, blue: 0.2))
                Text(prompt)
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            Button("下一张 »") { store.next() }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.8))

            if let urlString = card.sourceUrl, let url = URL(string: urlString) {
                Button("在网页里打开") { NSWorkspace.shared.open(url) }
                    .buttonStyle(.plain)
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(.top, 8)
    }

    private var placeholder: String {
        if !store.hasLoadedOnce { return "正在读知识库…" }
        if store.isOffline { return "本机 AITimeline 没有运行" }

        return "知识库里还没有该回来的卡"
    }
}
