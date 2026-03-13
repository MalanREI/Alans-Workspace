# Git Workflow for REI Team

## Setup (one time)

1. Clone the repo:
   ```
   git clone https://github.com/MalanREI/Little-Helper-Tool-with-features.git
   cd Little-Helper-Tool-with-features
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create your own `.env.local` file (never committed — each dev needs their own):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://omimswsfjfzbvjwiinkc.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   OPENAI_API_KEY=your-openai-key
   ANTHROPIC_API_KEY=your-anthropic-key
   ```

## Daily Workflow

### 1. Pull latest changes before starting work
```
git checkout main
git pull
```

### 2. Create a branch for your work
```
git checkout -b your-branch-name
```
Name it something descriptive, like `fix-login-bug` or `add-calendar-feature`.

### 3. Make your changes, then commit
```
git add <files you changed>
git commit -m "short description of what you did"
```

### 4. Push your branch
```
git push -u origin your-branch-name
```

### 5. Open a Pull Request on GitHub
- Go to the repo on GitHub
- Click "Compare & pull request"
- Add a description of what you changed and why
- Request a review from your teammate

### 6. Review and merge
- The other person reviews the PR
- If it looks good, merge it into main
- If changes are needed, push more commits to the same branch

### 7. After merge, update your local main
```
git checkout main
git pull
```

## Rules

- **Never push directly to main.** Always use a branch + pull request.
- **Pull before you branch.** Always start from the latest main.
- **Never commit `.env.local`.** It contains secrets and is gitignored.
- **Keep branches small.** One feature or fix per branch — easier to review.
- **Delete your branch after merge.** Keeps things clean.
