FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    wget \
    bash \
    vim \
    nano \
    openssh-client \
    tmux \
    neovim \
    python3 \
    py3-pip \
    make \
    gcc \
    g++ \
    libc-dev \
    ripgrep \
    fd \
    lazygit \
    tree \
    unzip \
    cargo \
    rust \
    nodejs \
    npm \
    yarn \
    fzf \
    the_silver_searcher \
    ctags

# Verify Neovim version is 0.9.0+
RUN nvim --version | head -n 1 && \
    if ! nvim --version | head -n 1 | grep -E "v0\.(9|[1-9][0-9])\." ; then \
        echo "Error: Neovim version must be 0.9.0 or higher" && exit 1; \
    fi

# Install additional Python packages needed by LunarVim
RUN pip3 install --break-system-packages pynvim

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/cli/install.sh | sh

# Set up a workspace directory
WORKDIR /workspace

# Create a non-root user for better security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Give appuser ownership of workspace and home directory
RUN chown -R appuser:appgroup /workspace /home/appuser

# Switch to non-root user
USER appuser

# Set environment variables
ENV SHELL=/bin/bash
ENV EDITOR=nvim

# Install LunarVim (release 1.4 for Neovim 0.9)
RUN LV_BRANCH='release-1.4/neovim-0.9' bash <(curl -s https://raw.githubusercontent.com/LunarVim/LunarVim/release-1.4/neovim-0.9/utils/installer/install.sh) --no-interaction

# Add LunarVim to PATH
ENV PATH="/home/appuser/.local/bin:$PATH"

# Create tmux config with sensible defaults
RUN echo '# Tmux configuration\n\
set -g default-terminal "screen-256color"\n\
set -g mouse on\n\
set -g prefix C-a\n\
unbind C-b\n\
bind C-a send-prefix\n\
\n\
# Enable true colors\n\
set -ga terminal-overrides ",xterm-256color:Tc"\n\
\n\
# Set scrollback buffer size\n\
set -g history-limit 50000\n\
\n\
# Enable focus events\n\
set -g focus-events on\n\
\n\
# No delay for escape key\n\
set -sg escape-time 0\n\
\n\
# Split panes using | and -\n\
bind | split-window -h\n\
bind - split-window -v\n\
unbind '"'"'"\n\
unbind %\n\
\n\
# Switch panes using Alt-arrow without prefix\n\
bind -n M-Left select-pane -L\n\
bind -n M-Right select-pane -R\n\
bind -n M-Up select-pane -U\n\
bind -n M-Down select-pane -D\n\
\n\
# Reload config file\n\
bind r source-file ~/.tmux.conf \\; display-message "Config reloaded!"\n\
\n\
# Start windows and panes at 1, not 0\n\
set -g base-index 1\n\
setw -g pane-base-index 1\n\
\n\
# Status bar customization\n\
set -g status-bg black\n\
set -g status-fg white\n\
set -g status-left "#[fg=green]#S "\n\
set -g status-right "#[fg=yellow]#(whoami)@#h"' > /home/appuser/.tmux.conf

# Create a nice bash profile
RUN echo '# Bash configuration\n\
export EDITOR=nvim\n\
export SHELL=/bin/bash\n\
export PATH="/home/appuser/.local/bin:$PATH"\n\
\n\
# Aliases\n\
alias ll="ls -la"\n\
alias la="ls -A"\n\
alias l="ls -CF"\n\
alias vim="nvim"\n\
alias vi="nvim"\n\
alias lv="lvim"\n\
alias lg="lazygit"\n\
alias gs="git status"\n\
alias ga="git add"\n\
alias gc="git commit"\n\
alias gp="git push"\n\
alias gpl="git pull"\n\
alias gd="git diff"\n\
\n\
# Claude Code aliases\n\
alias cc="claude-code"\n\
alias claude="claude-code"\n\
\n\
# Welcome message\n\
echo "🚀 Craftify Development Environment"\n\
echo "📝 Editors: nvim, lvim (LunarVim)"\n\
echo "🔧 Tools: tmux, git, lazygit, claude-code"\n\
echo "💾 Your tmux session persists across reconnections!"\n\
echo "🔑 Tmux prefix: Ctrl+A (use Ctrl+A ? for help)"\n\
echo "🤖 Use '"'"'claude'"'"' or '"'"'cc'"'"' for Claude Code CLI"\n\
echo ""' > /home/appuser/.bashrc

# Set default command to bash with login shell
CMD ["/bin/bash", "-l"]