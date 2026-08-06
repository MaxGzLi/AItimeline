import AppKit
import SwiftUI

/// AI 进程面:Claude Code 现在在干什么。
///
/// 骨架跟别的面一模一样(左栏 / 竖线 / 右 236),切面的时候两条竖线纹丝不动。
///
/// **不给它上色。** 原版是紫色在干活、黄色等你、绿色干完了、红色出错;
/// 我们这块面板只有白色的明暗梯队,那一点琥珀色只绑一件事 ——「轮到你动手了」。
/// 「等你回话」和「这轮挂了」正好是那件事,所以它们是这个面上唯一有颜色的东西;
/// 「在干活」「干完了」「闲着」的区别靠字说清楚,不靠颜色。
struct AgentsFace: View {
    @EnvironmentObject private var appState: AppState
    @ObservedObject private var agents = AgentStore.shared

    private var sidePadding: CGFloat { appState.contentSidePadding }
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
                .padding(.bottom, Constants.footerBottomInset)
        }
        // **只有这一面真的铺在半屏面板上才算「看过了」。** 鼠标蹭一下刘海弹出来的小条
        // 不算 —— 那一档只画一行,而且画的是排最前的那个会话,干完的那个根本没露脸。
        .onAppear {
            agents.refresh()
            agents.faceVisible = true
        }
        .onDisappear { agents.faceVisible = false }
    }

    private var columns: some View {
        let total = appState.currentSize.width - sidePadding * 2
        let main = max(320, total - columnGap * 2 - 1 - sideWidth)

        return HStack(spacing: 0) {
            mainColumn
                .frame(width: main)

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

    // MARK: - 左栏:会话列表

    /// **有会话就先列会话**,再看接没接上。反过来写的话,右栏明明数着「1 个等你回话」、
    /// 左边却还在劝你接线 —— 同一块面板上两句话打架。
    @ViewBuilder
    private var mainColumn: some View {
        if agents.sessions.isEmpty {
            if agents.hooked { quiet } else { invitation }
        } else {
            // 会话可能比一屏多。没有滚动的话超出的行是**直接被切掉**的,看不见也够不着。
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(agents.sessions) { session in
                        row(session)

                        if session.id != agents.sessions.last?.id {
                            Rectangle()
                                .fill(NotchSurface.hairline)
                                .frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    /// 一行一个会话。点一下用 Finder 打开那个目录 —— 原版是跳回终端标签页,
    /// 那要能驱动 Warp / Terminal 的界面脚本,权限和适配都是另一摊事,先不做。
    private func row(_ session: AgentSession) -> some View {
        Button {
            // 空路径会把 Finder 打开到根目录,平白弹一个莫名其妙的窗口。
            guard !session.cwd.isEmpty,
                  FileManager.default.fileExists(atPath: session.cwd) else { return }

            NSWorkspace.shared.open(URL(fileURLWithPath: session.cwd))
        } label: {
            HStack(alignment: .center, spacing: 12) {
                StateMark(state: session.state)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(session.project)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(NotchInk.body)
                            .lineLimit(1)

                        // 干完了、你还没看过的,留一个白点。看过就没了。
                        if session.unseen {
                            Circle()
                                .fill(.white.opacity(0.75))
                                .frame(width: 5, height: 5)
                        }
                    }

                    Text(session.shortPath)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(NotchInk.faint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer(minLength: 12)

                VStack(alignment: .trailing, spacing: 3) {
                    Text(session.state.title)
                        .font(.system(size: 11, weight: session.state.needsYou ? .semibold : .medium))
                        .foregroundStyle(
                            session.state.needsYou
                                ? NotchAccent.amber.opacity(0.90)
                                : NotchInk.weak
                        )

                    Text(session.silence(at: agents.now))
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(NotchInk.ghost)
                }
            }
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("在 Finder 里打开 \(session.shortPath)")
        .hoverPointer()
    }

    /// 还没接线。这一屏要说清三件事:接了能看到什么、我会动你哪个文件、随时能拆。
    private var invitation: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)

            Text("看得见 Claude Code 在干什么")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(NotchInk.title)

            Spacer().frame(height: 6)

            Text("接上以后,哪个会话停下来要权限、哪个跑挂了、哪个干完了还没看,刘海上直接就有。在干活的不占刘海 —— 那是它的事,不用你管。")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(NotchInk.faint)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 420, alignment: .leading)

            Spacer().frame(height: 16)

            Button {
                agents.connect()
            } label: {
                Text("接上 Claude Code")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.black.opacity(0.85))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(.white.opacity(0.92)))
            }
            .buttonStyle(.plain)
            .hoverPointer()

            Spacer().frame(height: 12)

            Text(agents.lastError ?? "会往 ~/.claude/settings.json 里加几条钩子,动之前先存一份 .aitimeline-bak。随时可以拆掉。")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(agents.lastError == nil ? NotchInk.ghost : NotchAccent.amber.opacity(0.85))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 420, alignment: .leading)

            Spacer(minLength: 0)
        }
    }

    private var quiet: some View {
        VStack(alignment: .leading, spacing: 6) {
            Spacer(minLength: 0)

            Text("现在没有会话")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(NotchInk.title)

            Text("开一个 Claude Code,它自己会出现在这儿。")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(NotchInk.faint)

            Spacer(minLength: 0)
        }
    }

    // MARK: - 右栏

    private var sideColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("眼下")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 10)

            tally("要你动手", agents.needsYou, urgent: agents.needsYou > 0)

            Spacer().frame(height: 8)

            tally("在干活", agents.working, urgent: false)

            Spacer().frame(height: 8)

            tally("干完了", agents.unseen, urgent: false)

            Spacer(minLength: 16)

            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            Spacer().frame(height: 10)

            Text("怎么看出来的")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(NotchInk.label)

            Spacer().frame(height: 4)

            Text("只在要你动手的时候占刘海:停下来要权限、这一轮挂了、或者干完了你还没看见。在干活不占 —— 那是它的事。脚本起的一次性会话根本不收。全在本机,不联网、不读你的对话内容。")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

            if agents.hooked {
                Spacer().frame(height: 10)

                Button("拆掉钩子") { agents.disconnect() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
                    .hoverPointer()
            }
        }
    }

    private func tally(_ label: String, _ count: Int, urgent: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(max(0, count))")
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(urgent ? NotchAccent.amber.opacity(0.92) : NotchInk.body)
                .frame(width: 30, alignment: .leading)

            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(NotchInk.faint)
        }
    }

    // MARK: - 底通栏

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(NotchSurface.hairline)
                .frame(height: 1)

            HStack(spacing: 20) {
                Text(agents.hooked ? "已经接上 Claude Code" : "还没接上")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))

                Spacer(minLength: 12)

                Text("点一行,在 Finder 里打开那个项目")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(NotchInk.faint)
            }
            .frame(height: 15)
            .padding(.vertical, 12)
        }
    }
}

struct AgentsShoulderTrailing: View {
    @ObservedObject private var agents = AgentStore.shared

    var body: some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)

            if agents.needsYou > 0 {
                Circle()
                    .fill(NotchAccent.amber.opacity(0.92))
                    .frame(width: 4, height: 4)
            }

            Text(agents.summary)
                .font(.system(size: 10, weight: agents.needsYou > 0 ? .semibold : .medium))
                .monospacedDigit()
                .foregroundStyle(agents.needsYou > 0 ? NotchAccent.amber.opacity(0.90) : NotchInk.ghost)
        }
    }
}

/// 状态的记号。原版是一个 5×5 的像素方块在动;这里留住「一个方块、里面有格子」
/// 的样子,但格子只有白色深浅 —— 干活的时候一格一格轮着亮,像有东西在里面跑。
struct StateMark: View {
    let state: AgentSession.State

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let size: CGFloat = 30
    /// 3×3 九格。原版是 5×5,但那是给 24 点的方块画的;我们这块 30 点、
    /// 面板离眼睛更远,5×5 的格子只有 2 点宽,看着是一团糊的灰。
    private static let side = 3
    private static let beat: TimeInterval = 0.22

    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(NotchSurface.tile)
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(NotchSurface.tileEdge, lineWidth: 1)
            )
            .overlay(marquee)
            .frame(width: size, height: size)
    }

    /// **只有在干活的时候才让它动。** 用 `TimelineView` 不用 `Timer`:
    /// 状态一变这层就整个不见了,没有「计时器还留着空转」这种事要收拾。
    @ViewBuilder
    private var marquee: some View {
        if state == .working, !reduceMotion {
            TimelineView(.periodic(from: .now, by: Self.beat)) { context in
                grid(step: Self.step(at: context.date))
            }
        } else {
            grid(step: 0)
        }
    }

    private func grid(step: Int) -> some View {
        VStack(spacing: 2) {
            ForEach(0..<Self.side, id: \.self) { row in
                HStack(spacing: 2) {
                    ForEach(0..<Self.side, id: \.self) { column in
                        RoundedRectangle(cornerRadius: 1, style: .continuous)
                            .fill(ink(row * Self.side + column, step: step))
                            .frame(width: 4, height: 4)
                    }
                }
            }
        }
        .animation(.easeInOut(duration: 0.10), value: step)
    }

    private static func step(at date: Date) -> Int {
        Int(date.timeIntervalSinceReferenceDate / beat) % (side * side)
    }

    /// 三种状态三种画法:
    /// - 等你回话:整格都亮着琥珀,不动 —— 它就是停在那儿不动了;
    /// - 在干活:一格一格轮着走,像有东西在里面跑;
    /// - 闲着:只有中间一格,很淡。
    private func ink(_ index: Int, step: Int) -> Color {
        switch state {
        case .waiting, .failed:
            return NotchAccent.amber.opacity(0.85)
        case .working:
            return .white.opacity(index == step ? 0.85 : 0.14)
        case .idle:
            return .white.opacity(index == Self.side * Self.side / 2 ? 0.32 : 0.07)
        }
    }
}
