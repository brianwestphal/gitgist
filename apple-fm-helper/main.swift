// Apple Foundation Models helper for gitgist's on-device `apple` provider.
//
// Node can't call Apple's native `FoundationModels` framework, so gitgist shells
// out to this tiny Swift CLI (see `src/providers/apple.ts`). Unlike the Hot Sheet
// reference (which uses `@Generable` guided generation to emit a fixed JSON
// shape), gitgist wants **freeform Markdown**, so this just runs the model and
// prints its text response verbatim.
//
// Protocol:
//   apple-fm-helper --probe      → prints "available" or "unavailable" (exit 0)
//   apple-fm-helper --generate   → reads {"system","prompt"} JSON on stdin,
//                                   writes the model's Markdown to stdout (exit 0)
//
// Requires macOS 26+ on Apple Silicon with Apple Intelligence (FoundationModels).
// Build with scripts/build-apple-fm-helper.sh; point gitgist at the binary with
// GITGIST_APPLE_FM_BIN (or build it to ./bin/apple-fm-helper).
import Foundation
import FoundationModels

/// Wire input read from stdin for `--generate`.
struct GenerateInput: Decodable {
    let system: String
    let prompt: String
}

private func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

/// Print on-device model availability and exit.
private func probe() -> Never {
    switch SystemLanguageModel.default.availability {
    case .available:
        print("available")
    default:
        print("unavailable")
    }
    exit(0)
}

/// Read {system, prompt} from stdin, run one on-device generation, print the
/// model's Markdown response to stdout.
private func generate() async -> Never {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let input = try? JSONDecoder().decode(GenerateInput.self, from: data) else {
        fail("invalid input: expected {\"system\",\"prompt\"} JSON on stdin", code: 2)
    }
    guard case .available = SystemLanguageModel.default.availability else {
        fail("Apple Foundation Models unavailable", code: 3)
    }
    do {
        let session = LanguageModelSession(instructions: input.system)
        let response = try await session.respond(to: input.prompt)
        print(response.content)
        exit(0)
    } catch {
        fail("inference failed: \(error)", code: 4)
    }
}

let args = CommandLine.arguments
if args.contains("--probe") {
    probe()
} else if args.contains("--generate") {
    // Run the async work, then park the main thread; `generate()` calls exit()
    // when done, which terminates the process.
    Task { await generate() }
    dispatchMain()
} else {
    fail("usage: apple-fm-helper --probe | --generate", code: 64)
}
