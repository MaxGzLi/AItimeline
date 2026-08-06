import AppKit
import SwiftUI

/// 收集面:拖进刘海的东西都落在这儿,以及它们后来怎么样了。
///
/// 骨架和知识面**完全一样**(左 531 / 竖线 / 右 236),切面的时候两条竖线纹丝不动。
/// 左栏是条目,右栏说清楚这个面收什么、不收什么 —— 拖错了东西没反应最气人。
struct ShelfFace: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var shelf = ShelfStore.shared

    private let sidePadding = Constants.fullExpandedSidePadding
    private let columnGap: CGFloat = 20
    private let sideWidth: CGFloat = 236

    var body: some View {
        VStack(spacing: 0) {
            columns
                .padding(.horizontal, sidePadding)
                .padding(.top, 12)
                .frame(maxHeight: .infinity, alignment: .top)

            footer
                .padding(.horizontal, sidePadding)
        }
        .task {
            await shelf.refreshStatuses()
        }
    }

    private var columns: some View {
        let total = appState.currentSize.width - sidePadding * 2
        let list = max(320, total - columnGap * 2 - 1 - sideWidth)

        return HStack(spacing: 0) {
            listColumn
                .frame(width: list)

            Spacer()
                .frame(width: columnGap)

            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(width: 1)
                .padding(.vertical, 4)

            Spacer()
                .frame(width: columnGap)

            sideColumn
                .frame(width: sideWidth)
        }
    }

    // MARK: - 条目

    @ViewBuilder
    private var listColumn: some View {
        if shelf.items.isEmpty {
            dropZone
        } else {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 6) {
                    ForEach(shelf.items) { item in
                        ShelfRow(item: item)
                    }
                }
                .padding(.bottom, 12)
            }
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: 0.90),
                        .init(color: .clear, location: 1.0)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
    }

    private var dropZone: some View {
        VStack(spacing: 8) {
            Spacer()

            Image(systemName: "tray.and.arrow.down")
                .font(.system(size: 20))
                .foregroundStyle(NotchInk.faint)

            Text("把东西拖到刘海上")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.50))

            Text("链接、选中的文字、截图都行")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(NotchSurface.stroke, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        )
    }

    // MARK: - 右栏:这个面收什么

    private var sideColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("拖进来会怎样")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 10)

            intake("链接", "去抓正文,出带引文的知识卡", ink: 0.24)
            Spacer().frame(height: 12)
            intake("文字", "存成笔记,不过引文检查", ink: 0.18)
            Spacer().frame(height: 12)
            intake("截图", "本机认出字,再存成笔记", ink: 0.14)

            Spacer(minLength: 16)

            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            Spacer().frame(height: 10)

            Text("存不下的")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 4)

            Text("本地文件、私网地址。本地文件的出处该写什么还没定,没定就不硬做。")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func intake(_ name: String, _ what: String, ink: Double) -> some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(.white.opacity(ink))
                .frame(width: 3, height: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(NotchInk.read)

                Text(what)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - 底通栏

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            HStack(spacing: 20) {
                Text(shelf.items.isEmpty ? "架子是空的" : "\(shelf.items.count) 条")
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.45))

                Spacer(minLength: 12)

                if shelf.items.contains(where: { $0.status != ShelfStore.sending && $0.canRetry != true }) {
                    Button("清掉有结果的") {
                        shelf.clearSaved()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.meta)
                    .hoverPointer()
                }
            }
            .frame(height: 15)
            .padding(.vertical, 12)
        }
        .frame(height: 40)
    }
}

/// 收集面在肩栏右翼放的东西:还有几条没落地。
struct ShelfShoulderTrailing: View {
    @ObservedObject private var shelf = ShelfStore.shared

    var body: some View {
        let onTheWay: Set<String> = [ShelfStore.sending, "排队中", "正在转化"]
        let pending = shelf.items.filter { onTheWay.contains($0.status) }.count
        let failed = shelf.items.filter(\.failed).count

        HStack(spacing: 12) {
            Spacer(minLength: 0)

            if failed > 0 {
                Text("\(failed) 条没存进去")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(NotchAccent.amber.opacity(0.90))
            }

            if pending > 0 {
                Text("\(pending) 条在路上")
                    .font(.system(size: 10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.34))
            }

            Text("\(shelf.items.count)")
                .font(.system(size: 10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(NotchInk.ghost)
        }
    }
}

/// 架子上的一条。悬停才露出删除和重试 —— 常驻的话一列全是按钮。
private struct ShelfRow: View {
    let item: ShelfItem

    @ObservedObject private var shelf = ShelfStore.shared
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            icon

            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(NotchInk.read)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Text(item.detail)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            if hovering {
                if item.canRetry == true {
                    action("重试") { shelf.retry(item.id) }
                }

                action("删掉") { shelf.remove(item.id) }
            } else {
                Text(item.status)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(item.failed ? NotchAccent.amber.opacity(0.85) : .white.opacity(0.38))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(.white.opacity(item.failed ? 0.06 : 0.04)))
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 56)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.white.opacity(hovering ? 0.045 : 0))
        )
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.18), value: hovering)
    }

    private var icon: some View {
        RoundedRectangle(cornerRadius: 5.4, style: .continuous)
            .fill(NotchSurface.tile)
            .overlay(
                RoundedRectangle(cornerRadius: 5.4, style: .continuous)
                    .stroke(NotchSurface.tileEdge, lineWidth: 1)
            )
            .overlay(
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.62))
            )
            .frame(width: 36, height: 36)
    }

    private var symbol: String {
        switch item.kind {
        case .link: return "link"
        case .text: return "text.alignleft"
        case .image: return "photo"
        }
    }

    private func action(_ label: String, _ run: @escaping () -> Void) -> some View {
        Button(label, action: run)
            .buttonStyle(.plain)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(NotchInk.meta)
            .hoverPointer()
    }
}
