use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MoveError {
    #[error("action count must be between 1 and 13")]
    InvalidCount,
    #[error("source and destination must differ")]
    SameSlot,
    #[error("slot index is out of range")]
    InvalidIndex,
    #[error("source slot is empty")]
    EmptySource,
    #[error("only single-card moves are allowed for this action")]
    SingleCardOnly,
    #[error("destination free cell is occupied")]
    DestinationOccupied,
    #[error("foundation destination does not match the card suit")]
    FoundationSuitMismatch,
    #[error("card is not the next foundation rank")]
    FoundationRankMismatch,
    #[error("tableau move must alternate colors")]
    TableauColorMismatch,
    #[error("tableau move must descend by one rank")]
    TableauRankMismatch,
    #[error("the selected tableau run is not a valid movable sequence")]
    SequenceBroken,
    #[error("requested move exceeds the currently available temporary capacity")]
    InsufficientCapacity,
    #[error("foundations cannot move directly to foundations")]
    FoundationToFoundationUnsupported,
    #[error("game is already complete")]
    GameAlreadyWon,
}
