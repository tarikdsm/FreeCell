use crate::{
    Action, AutoPlayPolicy, Game, GameSnapshot, HintAnalysis, HintOptions, ReplayExport, StepResult,
};

#[derive(Debug, Clone, Copy)]
pub struct RewardConfig {
    pub illegal_penalty: f32,
    pub foundation_gain: f32,
    pub win_bonus: f32,
}

impl Default for RewardConfig {
    fn default() -> Self {
        Self {
            illegal_penalty: 0.0,
            foundation_gain: 1.0,
            win_bonus: 52.0,
        }
    }
}

pub struct FreecellEnvironment {
    game: Game,
    reward: RewardConfig,
}

impl FreecellEnvironment {
    pub fn new(seed: u32) -> Self {
        Self::with_policy(seed, AutoPlayPolicy::Off)
    }

    pub fn with_policy(seed: u32, policy: AutoPlayPolicy) -> Self {
        Self {
            game: Game::with_policy(seed, policy),
            reward: RewardConfig::default(),
        }
    }

    pub fn with_reward_config(mut self, reward: RewardConfig) -> Self {
        self.reward = reward;
        self
    }

    pub fn reset(&mut self, seed: u32) -> GameSnapshot {
        self.game.reset(seed);
        self.game.snapshot()
    }

    pub fn get_state(&self) -> GameSnapshot {
        self.game.snapshot()
    }

    pub fn legal_actions(&self) -> Vec<Action> {
        self.game.legal_actions()
    }

    pub fn legal_action_mask(&self) -> Vec<u8> {
        self.game.legal_action_mask()
    }

    pub fn hint(&self, options: HintOptions) -> HintAnalysis {
        self.game.hint_with_options(options)
    }

    pub fn step(&mut self, action: Action) -> StepResult {
        match self.game.apply_action(action) {
            Ok(turn) => {
                let terminal = self.game.is_terminal();
                let reward = turn.foundation_delta as f32 * self.reward.foundation_gain
                    + if terminal { self.reward.win_bonus } else { 0.0 };
                StepResult {
                    applied: true,
                    reward,
                    terminal,
                    turn: Some(turn),
                    state: self.game.snapshot(),
                    illegal_reason: None,
                }
            }
            Err(error) => StepResult {
                applied: false,
                reward: self.reward.illegal_penalty,
                terminal: self.game.is_terminal(),
                turn: None,
                state: self.game.snapshot(),
                illegal_reason: Some(error.to_string()),
            },
        }
    }

    pub fn is_terminal(&self) -> bool {
        self.game.is_terminal()
    }

    pub fn score_helper(&self) -> u16 {
        self.game.score()
    }

    pub fn export_replay(&self) -> ReplayExport {
        self.game.replay_export()
    }

    pub fn set_auto_play_policy(&mut self, policy: AutoPlayPolicy) {
        self.game.set_auto_play_policy(policy);
    }

    pub fn game(&self) -> &Game {
        &self.game
    }
}
