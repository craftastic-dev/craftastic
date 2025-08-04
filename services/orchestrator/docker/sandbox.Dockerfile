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
    ctags \
    ncurses \
    ncurses-terminfo \
    ncurses-terminfo-base \
    less

# Set up locale for proper UTF-8 support
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Remove custom terminfo - use system defaults instead

# Verify Neovim version is 0.9.0+
RUN nvim --version | head -n 1 && \
    if ! nvim --version | head -n 1 | grep -E "v0\.(9|[1-9][0-9])\." ; then \
        echo "Error: Neovim version must be 0.9.0 or higher" && exit 1; \
    fi

# Install additional Python packages needed by LunarVim
RUN pip3 install --break-system-packages pynvim

# Install Claude Code CLI
RUN curl -fsSL claude.ai/install.sh | bash

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

# Create minimal tmux config - vanilla approach
RUN cat > /home/appuser/.tmux.conf << 'EOF'
# Minimal tmux configuration for xterm.js compatibility
# Use standard xterm-256color (no custom terminfo)
set -g default-terminal "xterm-256color"

# Only essential true color support
set -sa terminal-overrides ',xterm-256color:RGB'

# Basic settings
set -g mouse off
set -g history-limit 50000
set -sg escape-time 0

# Mouse selection behavior - let xterm.js handle selection
# Disable tmux copy mode activation via mouse
set -g @prevent_copy_mode 'on'
unbind -T root MouseDrag1Pane

# Re-enable basic mouse events but don't enter copy mode
bind -T root MouseDown1Pane select-pane -t = \; send-keys -M

# Simple key bindings
set -g prefix C-a
unbind C-b
bind C-a send-prefix

# Split panes
bind | split-window -h
bind - split-window -v
unbind '"'
unbind %

# Reload config
bind r source-file ~/.tmux.conf \; display-message "Config reloaded!"

# Start at 1
set -g base-index 1
setw -g pane-base-index 1

# Simple status bar
set -g status-left "[#S] "
set -g status-right "%H:%M"
EOF

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

# Create minimal neovim configuration
RUN mkdir -p /home/appuser/.config/nvim && \
    cat > /home/appuser/.config/nvim/init.lua << 'EOF'
-- Minimal neovim configuration for terminal compatibility
-- Let neovim handle cursor automatically (don't override guicursor)

-- Let neovim detect terminal capabilities automatically
-- No manual termguicolors setting - let neovim decide
EOF

# Set ownership of nvim config
RUN chown -R appuser:appgroup /home/appuser/.config

# Set default command to bash with login shell
CMD ["/bin/bash", "-l"]