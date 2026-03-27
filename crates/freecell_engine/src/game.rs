use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
    fmt::Write,
};

use sha2::{Digest, Sha256};

use crate::{
    action::{ACTION_SPACE_SIZE, Action, SlotRef, encode_action},
    card::{CardId, Suit},
    error::MoveError,
    snapshot::{
        AutoPlayPolicy, ColumnView, EngineStatus, FoundationView, FreeCellView, GameSnapshot,
        HintAnalysis, HintKind, HintOptions, ReplayExport, StepResult, TurnRecord,
    },
    state::{Column, DealMode, GameState},
};

#[derive(Clone)]
pub struct Game {
    state: GameState,
    auto_play_policy: AutoPlayPolicy,
    history: Vec<TurnRecord>,
    redo_stack: Vec<TurnRecord>,
}

#[derive(Clone)]
struct SearchCandidate {
    game: Game,
    line: Vec<Action>,
    score: i32,
    depth: u8,
    order: u32,
}

impl PartialEq for SearchCandidate {
    fn eq(&self, other: &Self) -> bool {
        self.score == other.score && self.depth == other.depth && self.order == other.order
    }
}

impl Eq for SearchCandidate {}

impl PartialOrd for SearchCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SearchCandidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .cmp(&other.score)
            .then_with(|| other.depth.cmp(&self.depth))
            .then_with(|| other.order.cmp(&self.order))
    }
}

impl Game {
    pub fn new(seed: u32) -> Self {
        Self::with_policy(seed, AutoPlayPolicy::Off)
    }

    pub fn with_policy(seed: u32, auto_play_policy: AutoPlayPolicy) -> Self {
        Self {
            state: GameState::new(seed),
            auto_play_policy,
            history: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn from_state(state: GameState, auto_play_policy: AutoPlayPolicy) -> Self {
        Self {
            state,
            auto_play_policy,
            history: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn from_replay(replay: &ReplayExport) -> Result<Self, MoveError> {
        let mut game = Self::with_policy(replay.seed, replay.auto_play_policy);
        for turn in &replay.turns {
            for action in &turn.executed {
                let validated = game.validate_action(*action)?;
                game.apply_action_unchecked(validated);
            }
            game.history.push(turn.clone());
        }
        Ok(game)
    }

    pub fn seed(&self) -> u32 {
        self.state.seed
    }

    pub fn state(&self) -> &GameState {
        &self.state
    }

    pub fn auto_play_policy(&self) -> AutoPlayPolicy {
        self.auto_play_policy
    }

    pub fn set_auto_play_policy(&mut self, policy: AutoPlayPolicy) {
        self.auto_play_policy = policy;
    }

    pub fn reset(&mut self, seed: u32) {
        self.state = GameState::new(seed);
        self.history.clear();
        self.redo_stack.clear();
    }

    pub fn is_terminal(&self) -> bool {
        self.state.is_won()
    }

    pub fn score(&self) -> u16 {
        self.state.total_foundation_cards() as u16
    }

    pub fn can_undo(&self) -> bool {
        !self.history.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn snapshot(&self) -> GameSnapshot {
        GameSnapshot {
            version: 1,
            seed: self.state.seed,
            deal_mode: self.state.deal_mode,
            status: if self.state.is_won() {
                EngineStatus::Won
            } else {
                EngineStatus::Playing
            },
            auto_play_policy: self.auto_play_policy,
            move_count: self.history.len() as u32,
            turn_index: self.history.len() as u32,
            score: self.score(),
            legal_move_capacity: self.state.global_legal_move_capacity(),
            state_hash: self.state_hash(),
            foundations: Suit::ALL
                .into_iter()
                .map(|suit| FoundationView {
                    index: suit.index(),
                    suit,
                    count: self.state.foundations[suit.index() as usize],
                    next_rank: self.state.foundations[suit.index() as usize] + 1,
                    top_card: self.state.foundation_top(suit).map(Into::into),
                })
                .collect(),
            freecells: self
                .state
                .freecells
                .iter()
                .enumerate()
                .map(|(index, card)| FreeCellView {
                    index: index as u8,
                    card: card.map(Into::into),
                })
                .collect(),
            tableau: self
                .state
                .tableau
                .iter()
                .enumerate()
                .map(|(index, column)| ColumnView {
                    index: index as u8,
                    cards: column.iter().copied().map(Into::into).collect(),
                    movable_run_length: GameState::movable_run_length(column),
                    sorted_run_length: GameState::sorted_run_length(column),
                })
                .collect(),
        }
    }

    pub fn snapshot_json(&self) -> String {
        serde_json::to_string_pretty(&self.snapshot()).expect("snapshot must serialize")
    }

    pub fn snapshot_binary(&self) -> Vec<u8> {
        postcard::to_allocvec(&self.snapshot()).expect("snapshot must serialize")
    }

    pub fn replay_export(&self) -> ReplayExport {
        ReplayExport {
            version: 1,
            seed: self.state.seed,
            deal_mode: DealMode::Microsoft,
            auto_play_policy: self.auto_play_policy,
            turns: self.history.clone(),
            final_state_hash: self.state_hash(),
        }
    }

    pub fn replay_json(&self) -> String {
        serde_json::to_string_pretty(&self.replay_export()).expect("replay must serialize")
    }

    pub fn replay_binary(&self) -> Vec<u8> {
        postcard::to_allocvec(&self.replay_export()).expect("replay must serialize")
    }

    pub fn legal_actions(&self) -> Vec<Action> {
        let mut actions = Vec::with_capacity(64);

        for source in 0..8u8 {
            let column = &self.state.tableau[source as usize];
            if column.is_empty() {
                continue;
            }

            let movable_count = GameState::movable_run_length(column);
            for destination in 0..8u8 {
                if source == destination {
                    continue;
                }

                for count in 1..=movable_count {
                    self.push_if_legal(
                        &mut actions,
                        Action::new(
                            SlotRef::Tableau { index: source },
                            SlotRef::Tableau { index: destination },
                            count,
                        ),
                    );
                }
            }

            for destination in 0..4u8 {
                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Tableau { index: source },
                        SlotRef::Freecell { index: destination },
                        1,
                    ),
                );
                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Tableau { index: source },
                        SlotRef::Foundation { index: destination },
                        1,
                    ),
                );
            }
        }

        for source in 0..4u8 {
            if self.state.freecells[source as usize].is_none() {
                continue;
            }

            for destination in 0..8u8 {
                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Freecell { index: source },
                        SlotRef::Tableau { index: destination },
                        1,
                    ),
                );
            }

            for destination in 0..4u8 {
                if source == destination {
                    continue;
                }

                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Freecell { index: source },
                        SlotRef::Freecell { index: destination },
                        1,
                    ),
                );
                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Freecell { index: source },
                        SlotRef::Foundation { index: destination },
                        1,
                    ),
                );
            }
        }

        for source in 0..4u8 {
            if self
                .state
                .foundation_top(Suit::from_index(source).expect("valid foundation source"))
                .is_none()
            {
                continue;
            }

            for destination in 0..8u8 {
                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Foundation { index: source },
                        SlotRef::Tableau { index: destination },
                        1,
                    ),
                );
            }

            for destination in 0..4u8 {
                self.push_if_legal(
                    &mut actions,
                    Action::new(
                        SlotRef::Foundation { index: source },
                        SlotRef::Freecell { index: destination },
                        1,
                    ),
                );
            }
        }

        actions
    }

    pub fn legal_action_mask(&self) -> Vec<u8> {
        let mut mask = vec![0; ACTION_SPACE_SIZE];
        for action in self.legal_actions() {
            if let Some(index) = action.action_index {
                mask[index as usize] = 1;
            }
        }
        mask
    }

    pub fn hint(&self) -> HintAnalysis {
        self.hint_with_options(HintOptions::default())
    }

    pub fn hint_with_options(&self, options: HintOptions) -> HintAnalysis {
        if self.is_terminal() {
            return HintAnalysis {
                kind: HintKind::Unavailable,
                suggested: None,
                principal_variation: Vec::new(),
                explored_nodes: 0,
                solved: true,
                score: self.hint_score(0),
                message: "The game is already won.".to_string(),
            };
        }

        let root_actions = self.legal_actions();
        if root_actions.is_empty() {
            return HintAnalysis {
                kind: HintKind::Unavailable,
                suggested: None,
                principal_variation: Vec::new(),
                explored_nodes: 0,
                solved: false,
                score: self.hint_score(0),
                message: "No legal moves are available.".to_string(),
            };
        }

        let hint_policy = match self.auto_play_policy {
            AutoPlayPolicy::Off => AutoPlayPolicy::Safe,
            policy => policy,
        };
        if let Some(auto_action) = self.next_auto_play_action(hint_policy) {
            let mut preview = self.search_clone();
            let _ = preview.apply_action(auto_action);
            let solved = preview.is_terminal();
            return HintAnalysis {
                kind: HintKind::AutoPlay,
                suggested: Some(auto_action),
                principal_variation: vec![auto_action],
                explored_nodes: 1,
                solved,
                score: preview.hint_score(1),
                message: if solved {
                    "Move this card to the foundation to finish the game.".to_string()
                } else {
                    "A safe foundation move is available right now.".to_string()
                },
            };
        }

        if root_actions.len() == 1 {
            let only_action = root_actions[0];
            return HintAnalysis {
                kind: HintKind::Forced,
                suggested: Some(only_action),
                principal_variation: vec![only_action],
                explored_nodes: 1,
                solved: false,
                score: self.hint_score(0),
                message: "Only one legal move is available from this position.".to_string(),
            };
        }

        let mut frontier = BinaryHeap::new();
        let mut visited = HashMap::new();
        let mut insertion_order = 0u32;
        let mut explored_nodes = 0u32;
        let mut best: Option<HintAnalysis> = None;

        visited.insert(self.state_hash(), self.hint_score(0));

        for action in self.order_actions_for_search(root_actions) {
            let Some(candidate) =
                self.expand_search_candidate(action, &[], 1, &mut insertion_order)
            else {
                continue;
            };

            best = Some(Self::prefer_hint(
                best,
                self.analysis_from_candidate(&candidate),
            ));
            frontier.push(candidate);
        }

        while let Some(candidate) = frontier.pop() {
            explored_nodes += 1;
            if explored_nodes >= options.max_nodes {
                break;
            }

            if candidate.game.is_terminal() {
                let mut solved = self.analysis_from_solution(candidate.line, candidate.score);
                solved.explored_nodes = explored_nodes;
                return solved;
            }

            if candidate.depth >= options.max_depth {
                continue;
            }

            let actions = candidate
                .game
                .order_actions_for_search(candidate.game.legal_actions());
            for action in actions {
                let Some(child) = candidate.game.expand_search_candidate(
                    action,
                    &candidate.line,
                    candidate.depth + 1,
                    &mut insertion_order,
                ) else {
                    continue;
                };

                let hash = child.game.state_hash();
                let should_skip = visited
                    .get(&hash)
                    .is_some_and(|best_score| *best_score >= child.score);
                if should_skip {
                    continue;
                }
                visited.insert(hash, child.score);
                best = Some(Self::prefer_hint(
                    best,
                    self.analysis_from_candidate(&child),
                ));
                frontier.push(child);
            }
        }

        let mut hint = best.unwrap_or_else(|| HintAnalysis {
            kind: HintKind::Unavailable,
            suggested: None,
            principal_variation: Vec::new(),
            explored_nodes,
            solved: false,
            score: self.hint_score(0),
            message: "No hint could be produced for this position.".to_string(),
        });
        hint.explored_nodes = explored_nodes.max(hint.explored_nodes);
        hint
    }

    pub fn step(&mut self, action: Action) -> StepResult {
        match self.apply_action(action) {
            Ok(turn) => StepResult {
                applied: true,
                reward: turn.foundation_delta as f32,
                terminal: self.is_terminal(),
                turn: Some(turn),
                state: self.snapshot(),
                illegal_reason: None,
            },
            Err(error) => StepResult {
                applied: false,
                reward: 0.0,
                terminal: self.is_terminal(),
                turn: None,
                state: self.snapshot(),
                illegal_reason: Some(error.to_string()),
            },
        }
    }

    pub fn apply_action(&mut self, action: Action) -> Result<TurnRecord, MoveError> {
        let validated = self.validate_action(action)?;
        let foundation_before = self.state.total_foundation_cards();
        self.apply_action_unchecked(validated);

        let mut executed = vec![validated];
        executed.extend(self.execute_auto_play(self.auto_play_policy));

        Ok(self.commit_turn(Some(validated), executed, foundation_before))
    }

    pub fn run_auto_play(&mut self) -> Option<TurnRecord> {
        let foundation_before = self.state.total_foundation_cards();
        let executed = self.execute_auto_play(self.auto_play_policy);
        (!executed.is_empty()).then(|| self.commit_turn(None, executed, foundation_before))
    }

    pub fn undo(&mut self) -> Option<TurnRecord> {
        let turn = self.history.pop()?;
        for action in turn.executed.iter().rev().copied() {
            self.apply_action_unchecked(action.inverse());
        }
        self.redo_stack.push(turn.clone());
        Some(turn)
    }

    pub fn redo(&mut self) -> Option<TurnRecord> {
        let mut turn = self.redo_stack.pop()?;
        for action in turn.executed.iter().copied() {
            self.apply_action_unchecked(action);
        }
        turn.turn_index = self.history.len() as u32 + 1;
        self.history.push(turn.clone());
        Some(turn)
    }

    pub fn validate_action(&self, action: Action) -> Result<Action, MoveError> {
        if self.state.is_won() {
            return Err(MoveError::GameAlreadyWon);
        }
        if !(1..=13).contains(&action.count) {
            return Err(MoveError::InvalidCount);
        }
        if action.source == action.destination {
            return Err(MoveError::SameSlot);
        }

        self.ensure_slot(action.source)?;
        self.ensure_slot(action.destination)?;

        let normalized = Action {
            action_index: encode_action(action),
            ..action
        };

        match (normalized.source, normalized.destination) {
            (SlotRef::Foundation { .. }, SlotRef::Foundation { .. }) => {
                Err(MoveError::FoundationToFoundationUnsupported)
            }
            (SlotRef::Tableau { index: source }, SlotRef::Tableau { index: destination }) => {
                self.validate_tableau_to_tableau(source, destination, normalized.count)?;
                Ok(normalized)
            }
            (SlotRef::Tableau { index }, SlotRef::Freecell { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_tableau_to_freecell(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Tableau { index }, SlotRef::Foundation { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_tableau_to_foundation(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Freecell { index }, SlotRef::Tableau { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_freecell_to_tableau(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Freecell { index }, SlotRef::Freecell { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_freecell_to_freecell(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Freecell { index }, SlotRef::Foundation { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_freecell_to_foundation(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Foundation { index }, SlotRef::Tableau { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_foundation_to_tableau(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Foundation { index }, SlotRef::Freecell { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_foundation_to_freecell(index, destination)?;
                Ok(normalized)
            }
        }
    }

    fn ensure_slot(&self, slot: SlotRef) -> Result<(), MoveError> {
        match slot {
            SlotRef::Tableau { index } if index < 8 => Ok(()),
            SlotRef::Freecell { index } if index < 4 => Ok(()),
            SlotRef::Foundation { index } if index < 4 => Ok(()),
            _ => Err(MoveError::InvalidIndex),
        }
    }

    fn validate_tableau_to_freecell(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        if self.state.tableau[source as usize].is_empty() {
            return Err(MoveError::EmptySource);
        }
        if self.state.freecells[destination as usize].is_some() {
            return Err(MoveError::DestinationOccupied);
        }
        Ok(())
    }

    fn validate_tableau_to_foundation(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        let Some(&card) = self.state.tableau[source as usize].last() else {
            return Err(MoveError::EmptySource);
        };
        self.validate_card_to_foundation(card, destination)
    }

    fn validate_freecell_to_foundation(
        &self,
        source: u8,
        destination: u8,
    ) -> Result<(), MoveError> {
        let Some(card) = self.state.freecells[source as usize] else {
            return Err(MoveError::EmptySource);
        };
        self.validate_card_to_foundation(card, destination)
    }

    fn validate_foundation_to_tableau(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        let card = self
            .state
            .foundation_top(Suit::from_index(source).ok_or(MoveError::InvalidIndex)?)
            .ok_or(MoveError::EmptySource)?;
        self.validate_card_to_tableau(card, destination)
    }

    fn validate_foundation_to_freecell(
        &self,
        source: u8,
        destination: u8,
    ) -> Result<(), MoveError> {
        let _card = self
            .state
            .foundation_top(Suit::from_index(source).ok_or(MoveError::InvalidIndex)?)
            .ok_or(MoveError::EmptySource)?;
        if self.state.freecells[destination as usize].is_some() {
            return Err(MoveError::DestinationOccupied);
        }
        Ok(())
    }

    fn validate_freecell_to_tableau(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        let Some(card) = self.state.freecells[source as usize] else {
            return Err(MoveError::EmptySource);
        };
        self.validate_card_to_tableau(card, destination)
    }

    fn validate_freecell_to_freecell(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        if self.state.freecells[source as usize].is_none() {
            return Err(MoveError::EmptySource);
        }
        if self.state.freecells[destination as usize].is_some() {
            return Err(MoveError::DestinationOccupied);
        }
        Ok(())
    }

    fn validate_tableau_to_tableau(
        &self,
        source: u8,
        destination: u8,
        count: u8,
    ) -> Result<(), MoveError> {
        let source_column = &self.state.tableau[source as usize];
        if source_column.is_empty() || count as usize > source_column.len() {
            return Err(MoveError::EmptySource);
        }

        let slice = &source_column[source_column.len() - count as usize..];
        if !GameState::is_valid_movable_sequence(slice) {
            return Err(MoveError::SequenceBroken);
        }

        let available_capacity = self.transfer_capacity(source, destination);
        if count > available_capacity {
            return Err(MoveError::InsufficientCapacity);
        }

        self.validate_card_to_tableau(slice[0], destination)
    }

    fn validate_card_to_foundation(&self, card: CardId, destination: u8) -> Result<(), MoveError> {
        let suit = Suit::from_index(destination).ok_or(MoveError::InvalidIndex)?;
        if card.suit() != suit {
            return Err(MoveError::FoundationSuitMismatch);
        }
        if self.state.foundations[destination as usize] + 1 != card.rank() {
            return Err(MoveError::FoundationRankMismatch);
        }
        Ok(())
    }

    fn validate_card_to_tableau(&self, card: CardId, destination: u8) -> Result<(), MoveError> {
        let destination_column = &self.state.tableau[destination as usize];
        let Some(&top_card) = destination_column.last() else {
            return Ok(());
        };
        if card.color() == top_card.color() {
            return Err(MoveError::TableauColorMismatch);
        }
        if card.rank() + 1 != top_card.rank() {
            return Err(MoveError::TableauRankMismatch);
        }
        Ok(())
    }

    fn transfer_capacity(&self, source: u8, destination: u8) -> u8 {
        let empty_freecells = self.state.empty_freecell_count();
        let empty_columns = self
            .state
            .tableau
            .iter()
            .enumerate()
            .filter(|(index, column)| {
                *index != source as usize && *index != destination as usize && column.is_empty()
            })
            .count() as u8;

        (empty_freecells + 1) << empty_columns
    }

    fn apply_action_unchecked(&mut self, action: Action) {
        match (action.source, action.destination) {
            (SlotRef::Tableau { index: source }, SlotRef::Tableau { index: destination }) => {
                self.move_tableau_run(source, destination, action.count);
            }
            (SlotRef::Tableau { index: source }, SlotRef::Freecell { index: destination }) => {
                let card = self.state.tableau[source as usize]
                    .pop()
                    .expect("validated tableau source");
                self.state.freecells[destination as usize] = Some(card);
            }
            (SlotRef::Tableau { index: source }, SlotRef::Foundation { index: destination }) => {
                let card = self.state.tableau[source as usize]
                    .pop()
                    .expect("validated tableau source");
                self.state.foundations[destination as usize] = card.rank();
            }
            (SlotRef::Freecell { index: source }, SlotRef::Tableau { index: destination }) => {
                let card = self.state.freecells[source as usize]
                    .take()
                    .expect("validated freecell source");
                self.state.tableau[destination as usize].push(card);
            }
            (SlotRef::Freecell { index: source }, SlotRef::Freecell { index: destination }) => {
                let card = self.state.freecells[source as usize]
                    .take()
                    .expect("validated freecell source");
                self.state.freecells[destination as usize] = Some(card);
            }
            (SlotRef::Freecell { index: source }, SlotRef::Foundation { index: destination }) => {
                let card = self.state.freecells[source as usize]
                    .take()
                    .expect("validated freecell source");
                self.state.foundations[destination as usize] = card.rank();
            }
            (SlotRef::Foundation { index: source }, SlotRef::Tableau { index: destination }) => {
                let suit = Suit::from_index(source).expect("validated foundation index");
                let card = self
                    .state
                    .foundation_top(suit)
                    .expect("validated foundation source");
                self.state.foundations[source as usize] =
                    self.state.foundations[source as usize].saturating_sub(1);
                self.state.tableau[destination as usize].push(card);
            }
            (SlotRef::Foundation { index: source }, SlotRef::Freecell { index: destination }) => {
                let suit = Suit::from_index(source).expect("validated foundation index");
                let card = self
                    .state
                    .foundation_top(suit)
                    .expect("validated foundation source");
                self.state.foundations[source as usize] =
                    self.state.foundations[source as usize].saturating_sub(1);
                self.state.freecells[destination as usize] = Some(card);
            }
            _ => unreachable!("validated unsupported action"),
        }
    }

    fn move_tableau_run(&mut self, source: u8, destination: u8, count: u8) {
        let split_at = self.state.tableau[source as usize].len() - count as usize;
        let moved: Column = self.state.tableau[source as usize]
            .drain(split_at..)
            .collect();
        self.state.tableau[destination as usize].extend(moved);
    }

    fn execute_auto_play(&mut self, policy: AutoPlayPolicy) -> Vec<Action> {
        let mut actions = Vec::new();
        while let Some(action) = self.next_auto_play_action(policy) {
            self.apply_action_unchecked(action);
            actions.push(action);
        }
        actions
    }

    fn next_auto_play_action(&self, policy: AutoPlayPolicy) -> Option<Action> {
        if policy == AutoPlayPolicy::Off {
            return None;
        }

        for freecell_index in (0..4u8).rev() {
            if let Some(card) = self.state.freecells[freecell_index as usize]
                && self.is_safe_for_auto_play(card, policy)
            {
                return Some(Action::new(
                    SlotRef::Freecell {
                        index: freecell_index,
                    },
                    SlotRef::Foundation {
                        index: card.suit().index(),
                    },
                    1,
                ));
            }
        }

        for column_index in 0..8u8 {
            if let Some(&card) = self.state.tableau[column_index as usize].last()
                && self.is_safe_for_auto_play(card, policy)
            {
                return Some(Action::new(
                    SlotRef::Tableau {
                        index: column_index,
                    },
                    SlotRef::Foundation {
                        index: card.suit().index(),
                    },
                    1,
                ));
            }
        }

        None
    }

    fn push_if_legal(&self, actions: &mut Vec<Action>, action: Action) {
        if let Ok(validated) = self.validate_action(action) {
            actions.push(validated);
        }
    }

    fn search_clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            auto_play_policy: self.auto_play_policy,
            history: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    fn available_foundation_moves_count(&self) -> u8 {
        let tableau_moves = self
            .state
            .tableau
            .iter()
            .filter_map(|column| column.last().copied())
            .filter(|card| {
                self.validate_card_to_foundation(*card, card.suit().index())
                    .is_ok()
            })
            .count() as u8;
        let freecell_moves = self
            .state
            .freecells
            .iter()
            .flatten()
            .copied()
            .filter(|card| {
                self.validate_card_to_foundation(*card, card.suit().index())
                    .is_ok()
            })
            .count() as u8;

        tableau_moves + freecell_moves
    }

    fn hint_score(&self, depth: u8) -> i32 {
        if self.is_terminal() {
            return 100_000 - i32::from(depth) * 12;
        }

        let foundation_cards = i32::from(self.state.total_foundation_cards());
        let empty_freecells = i32::from(self.state.empty_freecell_count());
        let empty_columns = i32::from(self.state.empty_tableau_count());
        let foundation_moves = i32::from(self.available_foundation_moves_count());
        let legal_move_capacity = i32::from(self.state.global_legal_move_capacity());

        let movable_cards = self
            .state
            .tableau
            .iter()
            .map(|column| i32::from(GameState::movable_run_length(column)))
            .sum::<i32>();
        let sorted_cards = self
            .state
            .tableau
            .iter()
            .map(|column| i32::from(GameState::sorted_run_length(column)))
            .sum::<i32>();
        let blocked_cards = self
            .state
            .tableau
            .iter()
            .map(|column| column.len() as i32 - i32::from(GameState::movable_run_length(column)))
            .sum::<i32>();
        let tallest_column = self
            .state
            .tableau
            .iter()
            .map(|column| column.len() as i32)
            .max()
            .unwrap_or_default();

        foundation_cards * 1_200
            + foundation_moves * 140
            + empty_freecells * 55
            + empty_columns * 180
            + legal_move_capacity * 10
            + movable_cards * 14
            + sorted_cards * 4
            - blocked_cards * 11
            - tallest_column * 5
            - i32::from(depth) * 9
    }

    fn action_search_priority(&self, action: Action) -> i32 {
        let mut priority = 0;

        match action.destination {
            SlotRef::Foundation { .. } => {
                priority += 950;
            }
            SlotRef::Freecell { .. } => {
                priority -= 60;
            }
            SlotRef::Tableau { index } => {
                if self.state.tableau[index as usize].is_empty() {
                    priority += 120;
                }
            }
        }

        match action.source {
            SlotRef::Foundation { .. } => {
                priority -= 1_250;
            }
            SlotRef::Freecell { .. } => {
                priority += 30;
            }
            SlotRef::Tableau { index } => {
                let source_column = &self.state.tableau[index as usize];
                if source_column.len() == action.count as usize {
                    priority += 80;
                }
            }
        }

        if action.count > 1 {
            priority += i32::from(action.count) * 42;
        }

        let mut preview = self.search_clone();
        if let Ok(turn) = preview.apply_action(action) {
            priority += i32::from(turn.foundation_delta) * 220;
            if turn.auto_played {
                priority += 90;
            }
            priority += preview.hint_score(1) - self.hint_score(0);
        }

        priority
    }

    fn order_actions_for_search(&self, mut actions: Vec<Action>) -> Vec<Action> {
        actions.sort_by(|left, right| {
            self.action_search_priority(*right)
                .cmp(&self.action_search_priority(*left))
                .then_with(|| {
                    left.action_index
                        .unwrap_or(u16::MAX)
                        .cmp(&right.action_index.unwrap_or(u16::MAX))
                })
        });
        actions
    }

    fn expand_search_candidate(
        &self,
        action: Action,
        prefix: &[Action],
        depth: u8,
        insertion_order: &mut u32,
    ) -> Option<SearchCandidate> {
        let mut game = self.search_clone();
        let turn = game.apply_action(action).ok()?;
        let mut line = Vec::with_capacity(prefix.len() + turn.executed.len());
        line.extend_from_slice(prefix);
        line.extend(turn.executed.iter().copied());

        let mut score = game.hint_score(depth) + i32::from(turn.foundation_delta) * 180;
        if turn.auto_played {
            score += 80;
        }
        if matches!(action.source, SlotRef::Foundation { .. }) {
            score -= 600;
        }
        if matches!(action.destination, SlotRef::Freecell { .. }) {
            score -= 40;
        }

        let candidate = SearchCandidate {
            game,
            line,
            score,
            depth,
            order: *insertion_order,
        };
        *insertion_order += 1;

        Some(candidate)
    }

    fn analysis_from_candidate(&self, candidate: &SearchCandidate) -> HintAnalysis {
        let suggested = candidate.line.first().copied();
        let principal_variation = candidate.line.clone();
        let message = suggested
            .map(|action| {
                let prelude = self.describe_action(action);
                if candidate.game.is_terminal() {
                    format!("{prelude} starts a winning line from this position.")
                } else if principal_variation.len() > 1 {
                    format!("{prelude} keeps the strongest continuation open.")
                } else {
                    format!("{prelude} improves mobility and board pressure.")
                }
            })
            .unwrap_or_else(|| "No actionable hint is available.".to_string());

        HintAnalysis {
            kind: if candidate.game.is_terminal() {
                HintKind::Solved
            } else {
                HintKind::Search
            },
            suggested,
            principal_variation,
            explored_nodes: 1,
            solved: candidate.game.is_terminal(),
            score: candidate.score,
            message,
        }
    }

    fn analysis_from_solution(&self, line: Vec<Action>, score: i32) -> HintAnalysis {
        let suggested = line.first().copied();
        let message = suggested
            .map(|action| {
                format!(
                    "{} starts a line that wins from here.",
                    self.describe_action(action)
                )
            })
            .unwrap_or_else(|| "A winning line was found from this position.".to_string());

        HintAnalysis {
            kind: HintKind::Solved,
            suggested,
            principal_variation: line,
            explored_nodes: 1,
            solved: true,
            score,
            message,
        }
    }

    fn prefer_hint(current: Option<HintAnalysis>, candidate: HintAnalysis) -> HintAnalysis {
        let Some(existing) = current else {
            return candidate;
        };

        if candidate.solved != existing.solved {
            return if candidate.solved {
                candidate
            } else {
                existing
            };
        }

        if candidate.score != existing.score {
            return if candidate.score > existing.score {
                candidate
            } else {
                existing
            };
        }

        if candidate.principal_variation.len() != existing.principal_variation.len() {
            return if candidate.principal_variation.len() < existing.principal_variation.len() {
                candidate
            } else {
                existing
            };
        }

        let candidate_index = candidate
            .suggested
            .and_then(|action| action.action_index)
            .unwrap_or(u16::MAX);
        let existing_index = existing
            .suggested
            .and_then(|action| action.action_index)
            .unwrap_or(u16::MAX);

        if candidate_index < existing_index {
            candidate
        } else {
            existing
        }
    }

    fn describe_action(&self, action: Action) -> String {
        let source = self.slot_label(action.source);
        let destination = self.slot_label(action.destination);
        let moved_label = self
            .leading_card_for_action(action)
            .map(CardId::short_label)
            .unwrap_or_else(|| {
                format!(
                    "{} card{}",
                    action.count,
                    if action.count == 1 { "" } else { "s" }
                )
            });

        if action.count > 1 {
            format!("Move the run starting with {moved_label} from {source} to {destination}")
        } else {
            format!("Move {moved_label} from {source} to {destination}")
        }
    }

    fn slot_label(&self, slot: SlotRef) -> String {
        match slot {
            SlotRef::Tableau { index } => format!("column {}", index + 1),
            SlotRef::Freecell { index } => format!("free cell {}", index + 1),
            SlotRef::Foundation { index } => {
                let label = Suit::from_index(index)
                    .map(Self::foundation_name)
                    .unwrap_or("unknown");
                format!("{label} foundation")
            }
        }
    }

    fn foundation_name(suit: Suit) -> &'static str {
        match suit {
            Suit::Spades => "spades",
            Suit::Hearts => "hearts",
            Suit::Diamonds => "diamonds",
            Suit::Clubs => "clubs",
        }
    }

    fn leading_card_for_action(&self, action: Action) -> Option<CardId> {
        match action.source {
            SlotRef::Tableau { index } => {
                let column = &self.state.tableau[index as usize];
                let start = column.len().checked_sub(action.count as usize)?;
                column.get(start).copied()
            }
            SlotRef::Freecell { index } => self.state.freecells[index as usize],
            SlotRef::Foundation { index } => {
                let suit = Suit::from_index(index)?;
                self.state.foundation_top(suit)
            }
        }
    }

    fn is_safe_for_auto_play(&self, card: CardId, policy: AutoPlayPolicy) -> bool {
        if self
            .validate_card_to_foundation(card, card.suit().index())
            .is_err()
        {
            return false;
        }
        if matches!(policy, AutoPlayPolicy::Max) || card.rank() <= 2 {
            return true;
        }

        let required = card.rank() - 1;
        match card.suit() {
            Suit::Diamonds | Suit::Hearts => {
                self.state.foundations[Suit::Clubs.index() as usize] >= required
                    && self.state.foundations[Suit::Spades.index() as usize] >= required
            }
            Suit::Clubs | Suit::Spades => {
                self.state.foundations[Suit::Diamonds.index() as usize] >= required
                    && self.state.foundations[Suit::Hearts.index() as usize] >= required
            }
        }
    }

    fn commit_turn(
        &mut self,
        requested: Option<Action>,
        executed: Vec<Action>,
        foundation_before: u8,
    ) -> TurnRecord {
        self.redo_stack.clear();
        let record = TurnRecord {
            turn_index: self.history.len() as u32 + 1,
            requested,
            auto_played: requested.is_some_and(|_| executed.len() > 1) || requested.is_none(),
            foundation_delta: self.state.total_foundation_cards() as i16 - foundation_before as i16,
            executed,
        };
        self.history.push(record.clone());
        record
    }

    fn state_hash(&self) -> String {
        let mut canonical = String::new();
        write!(&mut canonical, "{}|", self.state.seed).expect("write to string");
        for foundation in self.state.foundations {
            write!(&mut canonical, "{foundation},").expect("write to string");
        }
        canonical.push('|');
        for slot in self.state.freecells {
            match slot {
                Some(card) => write!(&mut canonical, "{},", card.raw()).expect("write to string"),
                None => canonical.push_str("x,"),
            }
        }
        canonical.push('|');
        for column in &self.state.tableau {
            for card in column {
                write!(&mut canonical, "{},", card.raw()).expect("write to string");
            }
            canonical.push(';');
        }

        let hash = Sha256::digest(canonical.as_bytes());
        let mut encoded = String::with_capacity(hash.len() * 2);
        for byte in hash {
            write!(&mut encoded, "{byte:02x}").expect("write to string");
        }
        encoded
    }
}
