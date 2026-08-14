import { useStore } from "../state/store";

/** 播放中遇到选择节点时的分支选项覆盖层。 */
export function PlaybackChoiceOverlay() {
  const choice = useStore((s) => s.pendingChoice);
  const choosePlaybackOption = useStore((s) => s.choosePlaybackOption);
  const cancel = useStore((s) => s.setPendingChoice);

  if (!choice) return null;

  return (
    <div className="choice-backdrop" data-testid="playback-choice">
      <div className="choice-panel">
        <div className="choice-prompt">{choice.prompt}</div>
        {choice.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className="choice-option"
            onClick={() => choosePlaybackOption(i)}
            data-testid={`choice-option-${i}`}
          >
            {opt}
          </button>
        ))}
        <button type="button" className="icon-btn" style={{ alignSelf: "center" }} onClick={() => cancel(null)} aria-label="关闭选择">
          ✕
        </button>
      </div>
    </div>
  );
}
