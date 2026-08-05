import AppKit
import SwiftUI

/// 应用入口。没有主窗口、不进 Dock(`LSUIElement`),只有刘海和一个菜单栏图标。
@main
struct NotchApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()

        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: IslandWindowController?
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            let controller = IslandWindowController(appState: AppState.shared)

            controller.start()
            windowController = controller

            CardStore.shared.start()
            setUpStatusItem()
        }
    }

    /// 菜单栏留一个图标,否则这个应用装上之后没有任何地方能退出它。
    @MainActor
    private func setUpStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        item.button?.image = NSImage(
            systemSymbolName: "book.closed",
            accessibilityDescription: "AITimeline"
        )

        let menu = NSMenu()

        menu.addItem(
            withTitle: "刷新知识卡",
            action: #selector(refreshCards),
            keyEquivalent: "r"
        ).target = self
        menu.addItem(.separator())
        menu.addItem(
            withTitle: "退出 AITimeline",
            action: #selector(quit),
            keyEquivalent: "q"
        ).target = self

        item.menu = menu
        statusItem = item
    }

    @objc private func refreshCards() {
        Task { @MainActor in await CardStore.shared.refresh() }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}
