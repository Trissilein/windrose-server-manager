use std::sync::Arc;
use tokio::sync::Mutex;

use crate::types::{ServerState, ServerStatus};

pub struct ServerProcess {
    state: Arc<Mutex<ServerState>>,
    child: Arc<Mutex<Option<std::process::Child>>>,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ServerState::default())),
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn get_state(&self) -> ServerState {
        self.state.lock().await.clone()
    }

    pub async fn get_status(&self) -> ServerStatus {
        self.state.lock().await.status.clone()
    }
}
