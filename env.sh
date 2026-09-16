# Source this file to activate the gymDays conda env with correct PATH ordering.
#   source env.sh
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate gymDays
export PATH="$CONDA_PREFIX/bin:$PATH"
echo "gymDays env active — node $(node --version), python $(python --version)"
