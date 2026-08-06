import AppKit
import Foundation
import UniformTypeIdentifiers
import Vision

/// 拖进来的一坨东西到底是什么。
///
/// 探测顺序照原版:**文件网址 → 通用网址 → 图片 → 纯文字**,第一个命中就定案。
/// 顺序是有讲究的:从访达拖一个图片文件,系统同时广播 file-url 和 public.jpeg,
/// 先看 file-url 才能知道它是本地文件;从浏览器拖一张图只有图片数据没有网址。
extension ShelfStore {
    nonisolated static func extract(_ provider: NSItemProvider, into imageDirectory: URL) async -> ShelfItem? {
        let id = UUID().uuidString
        let now = Date()

        // 一、本地文件。是图片就认字,其余暂时不收(本地文件的出处地址该长什么样还没定)。
        if let url = await loadURL(provider), url.isFileURL {
            guard isImage(url) else { return nil }

            let copied = copyIntoShelf(url, imageDirectory: imageDirectory)
            let text = recognizeText(at: copied ?? url)

            return imageItem(id: id, path: copied?.path, text: text, now: now)
        }

        // 二、网址。这是质量最高的一条:后台会去抓、出带引文的真知识卡。
        if let url = await loadURL(provider), let clean = normalized(url) {
            return ShelfItem(
                id: id,
                kind: .link,
                title: url.host ?? clean,
                detail: "链接 · 会转化成知识卡",
                url: clean,
                text: nil,
                imagePath: nil,
                addedAt: now,
                status: "正在存…",
                failed: false
            )
        }

        // 三、图片数据(从浏览器、截图工具直接拖过来的,没有文件)。
        if let data = await loadImageData(provider) {
            let path = imageDirectory.appendingPathComponent("\(id).png")

            try? data.write(to: path)

            return imageItem(id: id, path: path.path, text: recognizeText(at: path), now: now)
        }

        // 四、纯文字。看着像网址就当网址,否则存成笔记。
        if let raw = await loadText(provider) {
            let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)

            guard !text.isEmpty else { return nil }

            if let url = URL(string: text), let clean = normalized(url) {
                return ShelfItem(
                    id: id,
                    kind: .link,
                    title: url.host ?? clean,
                    detail: "链接 · 会转化成知识卡",
                    url: clean,
                    text: nil,
                    imagePath: nil,
                    addedAt: now,
                    status: "正在存…",
                    failed: false
                )
            }

            return ShelfItem(
                id: id,
                kind: .text,
                title: firstLine(text),
                detail: "笔记 · 不过引文检查",
                url: nil,
                text: text,
                imagePath: nil,
                addedAt: now,
                status: "正在存…",
                failed: false
            )
        }

        return nil
    }

    // MARK: - 各种取值

    private nonisolated static func imageItem(id: String, path: String?, text: String, now: Date) -> ShelfItem {
        let hasText = !text.isEmpty

        return ShelfItem(
            id: id,
            kind: .image,
            title: hasText ? headline(text) : "截图",
            detail: hasText ? "截图 · 认出 \(text.count) 字,存成笔记" : "截图 · 没认出字",
            url: nil,
            text: hasText ? text : nil,
            imagePath: path,
            addedAt: now,
            status: hasText ? "正在存…" : "没认出内容",
            failed: !hasText
        )
    }

    /// 只收 http/https。接口那边 file:// 一律 400,本地文件的出处地址是个还没定的产品问题。
    private nonisolated static func normalized(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return nil
        }

        return url.absoluteString
    }

    private nonisolated static func firstLine(_ text: String) -> String {
        clip(text.split(separator: "\n").first.map(String.init) ?? text)
    }

    /// 截图的第一行几乎永远是菜单栏、标签页这种废话(实测认出来的头一行是「示签页」)。
    /// 取**最长的那一行**当标题:一屏里最长的一行基本就是正文。
    private nonisolated static func headline(_ text: String) -> String {
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        let longest = lines.max(by: { $0.count < $1.count }) ?? text

        return clip(longest)
    }

    private nonisolated static func clip(_ line: String) -> String {
        line.count > 60 ? String(line.prefix(60)) + "…" : line
    }

    private nonisolated static func isImage(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType)?.conforms(to: .image) ?? false
    }

    /// 系统给的那个临时网址出了闭包就失效,所以当场拷一份到自己的目录里。
    private nonisolated static func copyIntoShelf(_ url: URL, imageDirectory: URL) -> URL? {
        let target = imageDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(url.pathExtension.isEmpty ? "png" : url.pathExtension)

        do {
            try FileManager.default.copyItem(at: url, to: target)

            return target
        } catch {
            return nil
        }
    }

    /// 本机把图上的字认出来。**不联网、不过模型** —— 模型不在客户端这边。
    private nonisolated static func recognizeText(at url: URL) -> String {
        guard let image = NSImage(contentsOf: url),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return ""
        }

        let request = VNRecognizeTextRequest()

        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true

        try? VNImageRequestHandler(cgImage: cgImage).perform([request])

        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }

        return lines.joined(separator: "\n")
    }

    // MARK: - NSItemProvider 的异步包装

    private nonisolated static func loadURL(_ provider: NSItemProvider) async -> URL? {
        guard provider.canLoadObject(ofClass: URL.self) else { return nil }

        return await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                continuation.resume(returning: url)
            }
        }
    }

    private nonisolated static func loadText(_ provider: NSItemProvider) async -> String? {
        guard provider.canLoadObject(ofClass: NSString.self) else { return nil }

        return await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: NSString.self) { value, _ in
                continuation.resume(returning: (value as? NSString) as String?)
            }
        }
    }

    private nonisolated static func loadImageData(_ provider: NSItemProvider) async -> Data? {
        guard let identifier = provider.registeredTypeIdentifiers.first(where: {
            UTType($0)?.conforms(to: .image) ?? false
        }) else {
            return nil
        }

        return await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: identifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
    }
}
