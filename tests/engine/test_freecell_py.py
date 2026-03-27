from __future__ import annotations

import pytest

def load_binding():
    from freecell_py import ACTION_SPACE_SIZE, FreecellEnv

    return ACTION_SPACE_SIZE, FreecellEnv


def test_reset_exposes_expected_state_shape() -> None:
    _, FreecellEnv = load_binding()
    env = FreecellEnv(seed=1, auto_play_policy="off")

    state = env.get_state()

    assert state["seed"] == 1
    assert state["dealMode"] == "microsoft"
    assert state["autoPlayPolicy"] == "off"
    assert state["status"] == "playing"
    assert len(state["tableau"]) == 8
    assert len(state["freecells"]) == 4
    assert len(state["foundations"]) == 4
    assert sum(len(column["cards"]) for column in state["tableau"]) == 52
    assert state["stateHash"]


def test_legal_action_mask_matches_serialized_actions() -> None:
    ACTION_SPACE_SIZE, FreecellEnv = load_binding()
    env = FreecellEnv(seed=1)

    actions = env.legal_actions()
    mask = env.legal_action_mask()
    encoded_actions = [action["actionIndex"] for action in actions]

    assert len(mask) == ACTION_SPACE_SIZE
    assert sum(mask) == len(actions)
    assert all(index is not None for index in encoded_actions)
    for action_index in encoded_actions:
        assert mask[action_index] == 1


def test_step_advances_replay_and_state_consistently() -> None:
    _, FreecellEnv = load_binding()
    env = FreecellEnv(seed=1)
    first_action_index = env.legal_actions()[0]["actionIndex"]

    assert first_action_index is not None

    result = env.step(first_action_index)
    replay = env.export_replay()

    assert result["applied"] is True
    assert result["state"]["moveCount"] >= 1
    assert result["state"]["stateHash"] == env.get_state()["stateHash"]
    assert replay["seed"] == 1
    assert len(replay["turns"]) >= 1


def test_invalid_action_index_raises_value_error() -> None:
    ACTION_SPACE_SIZE, FreecellEnv = load_binding()
    env = FreecellEnv(seed=1)

    with pytest.raises(ValueError):
        env.step(ACTION_SPACE_SIZE)
