use freecell_engine::{ACTION_SPACE_SIZE, AutoPlayPolicy, FreecellEnvironment, decode_action};
use pyo3::{exceptions::PyValueError, prelude::*};
use pythonize::pythonize;

#[pyclass(name = "FreecellEnv")]
pub struct PyFreecellEnv {
    inner: FreecellEnvironment,
}

#[pymethods]
impl PyFreecellEnv {
    #[new]
    #[pyo3(signature = (seed=1, auto_play_policy="off"))]
    fn new(seed: u32, auto_play_policy: &str) -> PyResult<Self> {
        Ok(Self {
            inner: FreecellEnvironment::with_policy(seed, parse_policy(auto_play_policy)?),
        })
    }

    fn reset<'py>(&mut self, py: Python<'py>, seed: u32) -> PyResult<Py<PyAny>> {
        Ok(pythonize(py, &self.inner.reset(seed)).map(|value| value.unbind())?)
    }

    fn get_state<'py>(&self, py: Python<'py>) -> PyResult<Py<PyAny>> {
        Ok(pythonize(py, &self.inner.get_state()).map(|value| value.unbind())?)
    }

    fn legal_actions<'py>(&self, py: Python<'py>) -> PyResult<Py<PyAny>> {
        Ok(pythonize(py, &self.inner.legal_actions()).map(|value| value.unbind())?)
    }

    fn legal_action_mask(&self) -> Vec<u8> {
        self.inner.legal_action_mask()
    }

    fn step<'py>(&mut self, py: Python<'py>, action: u16) -> PyResult<Py<PyAny>> {
        let action = decode_action(action)
            .ok_or_else(|| PyValueError::new_err("action index is out of range"))?;
        Ok(pythonize(py, &self.inner.step(action)).map(|value| value.unbind())?)
    }

    fn is_terminal(&self) -> bool {
        self.inner.is_terminal()
    }

    fn score_helper(&self) -> u16 {
        self.inner.score_helper()
    }

    fn export_replay<'py>(&self, py: Python<'py>) -> PyResult<Py<PyAny>> {
        Ok(pythonize(py, &self.inner.export_replay()).map(|value| value.unbind())?)
    }

    fn set_auto_play_policy(&mut self, auto_play_policy: &str) -> PyResult<()> {
        let policy = parse_policy(auto_play_policy)?;
        self.inner.set_auto_play_policy(policy);
        Ok(())
    }
}

#[pymodule]
fn freecell_py(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_class::<PyFreecellEnv>()?;
    module.add("ACTION_SPACE_SIZE", ACTION_SPACE_SIZE)?;
    Ok(())
}

fn parse_policy(policy: &str) -> PyResult<AutoPlayPolicy> {
    match policy {
        "off" => Ok(AutoPlayPolicy::Off),
        "safe" => Ok(AutoPlayPolicy::Safe),
        "max" => Ok(AutoPlayPolicy::Max),
        _ => Err(PyValueError::new_err(
            "auto play policy must be one of: off, safe, max",
        )),
    }
}
