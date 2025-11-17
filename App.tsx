import React, { useState, useCallback, useMemo, useEffect } from 'react';

// Use a global counter for unique IDs
let globalIdCounter = 0;
const generateUniqueId = () => `id-${globalIdCounter++}`;

// Interface for player
interface Player {
  id: string; // For unique key in React
  name: string;
}

// Interface for team data including players
interface Team {
  id: string; // For unique key
  name: string;
  players: Player[];
}

// Interface for team statistics
interface TeamStat {
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number; // Goals For
  ga: number; // Goals Against
  gd: number; // Goal Difference
  points: number;
}

// Interface for individual goal scorer entry
interface ScorerEntry {
  playerId: string;
  playerName: string;
  goals: number; // Changed to number, default to 1
}

// Interface for match results, including goal scorers
interface MatchResult {
  team1Id: string; // Added to reference Team ID
  team2Id: string; // Added to reference Team ID
  team1Score: number | '';
  team2Score: number | '';
  team1GoalScorers: ScorerEntry[]; // Now only stores players who actually scored
  team2GoalScorers: ScorerEntry[]; // Now only stores players who actually scored
  saved: boolean;
  goalScorerMismatch?: boolean; // New flag for validation UI
  isEditing?: boolean; // New flag for editing mode
  originalScores?: { team1: number | ''; team2: number | ''; }; // Store original scores for undoing stats
  originalGoalScorers?: { team1: ScorerEntry[]; team2: ScorerEntry[]; }; // Store original scorers for undoing stats
}

// Interface for saved league state
interface SavedLeagueState {
  numTeams: number;
  numPlayersPerTeam: number;
  submittedTeamData: Team[];
  matchResults: MatchResult[];
  teamStats: TeamStat[];
  roundNumber: number; // Still used as a flag: 0 for inactive, 1 for active
  allPlayedPairs: string[]; // Stored as array for serialization
  globalIdCounterValue: number; // Store the counter value
}

// Define application stages
type AppStage = 'initialScreen' | 'setupCounts' | 'namingTeamsAndPlayers' | 'loadLeagueOptions'; // Added loadLeagueOptions

const App: React.FC = () => {
  const [numTeams, setNumTeams] = useState<number>(0);
  const [numPlayersPerTeam, setNumPlayersPerTeam] = useState<number>(0);
  const [teamData, setTeamData] = useState<Team[]>([]); // Stores current team/player names during setup
  const [submittedTeamData, setSubmittedTeamData] = useState<Team[]>([]); // Stores team data after submission
  const [matches, setMatches] = useState<string[][]>([]); // Array of [team1Name, team2Name]
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStat[]>([]);
  const [roundNumber, setRoundNumber] = useState<number>(0); // 0: inactive/setup, 1: active league
  // FIX: Corrected useState declaration for allPlayedPairs to properly initialize a Set
  const [allPlayedPairs, setAllPlayedPairs] = useState<Set<string>>(new Set<string>()); // To track all pairs that have ever played
  
  const [appStage, setAppStage] = useState<AppStage>('initialScreen'); // New state for overall app stage
  const [currentTeamIndex, setCurrentTeamIndex] = useState<number>(0); // New state for sequential naming

  // States for save/load functionality
  const [savedLeagues, setSavedLeagues] = useState<Record<string, SavedLeagueState>>({});
  const [currentLeagueName, setCurrentLeagueName] = useState<string | null>(null); // Name of the actively loaded/saved league

  const [showSaveLeagueModal, setShowSaveLeagueModal] = useState(false);
  const [saveLeagueInputName, setSaveLeagueInputName] = useState('');
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [leagueNameToOverwrite, setLeagueNameToOverwrite] = useState('');

  // Existing warning/alert modal states
  const [showWarningModal, setShowWarningModal] = useState(false); 
  const [warningMessage, setWarningMessage] = useState('');
  // FIX: Corrected useState declaration for warningModalType
  const [warningModalType, setWarningModalType] = useState<'alert' | 'confirm'>('alert');
  
  // New state for league content view (instead of just showTopScorers)
  const [activeLeagueView, setActiveLeagueView] = useState<'matches' | 'topScorers' | 'matchResultsSummary'>('matches');
  const [currentMatchViewIndex, setCurrentMatchViewIndex] = useState<number>(0);

  // --- Local Storage Helpers ---
  const loadSavedLeaguesFromStorage = (): Record<string, SavedLeagueState> => {
    const storedLeagues = localStorage.getItem('savedLeagues');
    if (storedLeagues) {
      try {
        return JSON.parse(storedLeagues);
      } catch (error) {
        console.error('Failed to parse saved leagues from localStorage', error);
      }
    }
    return {};
  };

  const saveLeagueToStorage = useCallback((leagueName: string, state: SavedLeagueState) => {
    setSavedLeagues(prevLeagues => {
      const newLeagues = { ...prevLeagues, [leagueName]: state };
      localStorage.setItem('savedLeagues', JSON.stringify(newLeagues));
      return newLeagues;
    });
  }, []);

  const deleteLeagueFromStorage = useCallback((leagueName: string) => {
    setSavedLeagues(prevLeagues => {
      const newLeagues = { ...prevLeagues };
      delete newLeagues[leagueName];
      localStorage.setItem('savedLeagues', JSON.stringify(newLeagues));
      return newLeagues;
    });
  }, []);

  // Load saved leagues on component mount
  useEffect(() => {
    setSavedLeagues(loadSavedLeaguesFromStorage());
  }, []);

  const normalizePair = useCallback((teamA: string, teamB: string): string => {
    // For single round-robin, all matches are actual teams, no 'استراحت'
    const sortedNames = [teamA, teamB].sort();
    return `${sortedNames[0]}-${sortedNames[1]}`;
  }, []);

  // Helper to find the index of the first unsaved match
  const findFirstUnsavedMatchIndex = useCallback((results: MatchResult[]): number => {
    const firstUnsavedIndex = results.findIndex(match => !match.saved);
    return firstUnsavedIndex !== -1 ? firstUnsavedIndex : 0; // If all saved, go to the first match
  }, []);

  // Function to generate all unique pairs for a single round-robin tournament
  const generateAllRoundRobinMatches = useCallback((teams: Team[]) => {
    const newMatches: string[][] = [];
    const teamNames = teams.map(t => t.name);

    if (teamNames.length < 2) {
      setMatches([]);
      setMatchResults([]);
      setAllPlayedPairs(new Set<string>()); // Ensure reset
      return { newMatches: [], newMatchResults: [] };
    }

    // Generate all unique pairs for a single round-robin tournament
    for (let i = 0; i < teamNames.length; i++) {
      for (let j = i + 1; j < teamNames.length; j++) {
        newMatches.push([teamNames[i], teamNames[j]]);
      }
    }

    const newMatchResults: MatchResult[] = newMatches.map(match => {
      const team1 = teams.find(t => t.name === match[0]);
      const team2 = teams.find(t => t.name === match[1]);
      
      return {
        team1Id: team1?.id || '',
        team2Id: team2?.id || '',
        team1Score: '',
        team2Score: '',
        team1GoalScorers: [],
        team2GoalScorers: [],
        saved: false, // All matches initially unsaved
        goalScorerMismatch: false,
        isEditing: false, // Default to false
      };
    });

    return { newMatches, newMatchResults };
  }, []);

  // Removed the problematic useEffect that was automatically updating currentMatchViewIndex
  // whenever matchResults changed. This caused the jump when entering edit mode.
  // The currentMatchViewIndex will now be explicitly managed in startTheGames, handleLoadLeague,
  // and handleSaveResult.

  const handleScoreChange = useCallback((matchIndex: number, team: 'team1' | 'team2', value: string) => {
    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      const score = value === '' ? '' : parseInt(value, 10);
      newResults[matchIndex] = {
        ...newResults[matchIndex],
        [team === 'team1' ? 'team1Score' : 'team2Score']: score,
        // saved: false, // Keep saved status if editing
        goalScorerMismatch: false, // Reset mismatch flag on score change
      };
      return newResults;
    });
  }, []);

  const handlePlayerGoalChange = useCallback((matchIndex: number, teamNum: 1 | 2, scorerIndex: number, value: string) => {
    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      const currentMatchResult = { ...newResults[matchIndex] };
      const goals = value === '' ? 0 : parseInt(value, 10); // Ensure goals is a number

      if (teamNum === 1) {
        const newGoalScorers = [...currentMatchResult.team1GoalScorers];
        newGoalScorers[scorerIndex] = { ...newGoalScorers[scorerIndex], goals };
        currentMatchResult.team1GoalScorers = newGoalScorers;
      } else {
        const newGoalScorers = [...currentMatchResult.team2GoalScorers];
        newGoalScorers[scorerIndex] = { ...newGoalScorers[scorerIndex], goals };
        currentMatchResult.team2GoalScorers = newGoalScorers;
      }
      // currentMatchResult.saved = false; // Keep saved status if editing
      currentMatchResult.goalScorerMismatch = false; // Reset mismatch flag
      newResults[matchIndex] = currentMatchResult;
      return newResults;
    });
  }, []);

  const handleSelectGoalScorer = useCallback((matchIndex: number, teamNum: 1 | 2, playerId: string) => {
    if (!playerId) return; // Do nothing if no player is selected

    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      const currentMatchResult = { ...newResults[matchIndex] };
      let newGoalScorers: ScorerEntry[];
      let teamPlayers: Player[] = [];

      // Find the correct team from submittedTeamData using ID stored in matchResult
      const teamIdToFind = teamNum === 1 ? currentMatchResult.team1Id : currentMatchResult.team2Id;
      teamPlayers = submittedTeamData.find(t => t.id === teamIdToFind)?.players || [];

      if (teamNum === 1) {
        newGoalScorers = [...currentMatchResult.team1GoalScorers];
      } else {
        newGoalScorers = [...currentMatchResult.team2GoalScorers];
      }

      // Check if player is already in the list
      if (!newGoalScorers.some(scorer => scorer.playerId === playerId)) {
        const player = teamPlayers.find(p => p.id === playerId);
        if (player) {
          newGoalScorers.push({ playerId: player.id, playerName: player.name, goals: 1 }); // Default to 1 goal
        }
      }

      if (teamNum === 1) {
        currentMatchResult.team1GoalScorers = newGoalScorers;
      } else {
        currentMatchResult.team2GoalScorers = newGoalScorers;
      }
      // currentMatchResult.saved = false; // Keep saved status if editing
      currentMatchResult.goalScorerMismatch = false; // Reset mismatch flag
      newResults[matchIndex] = currentMatchResult;
      return newResults;
    });
  }, [submittedTeamData]); // Now depends on submittedTeamData

  const handleRemoveGoalScorer = useCallback((matchIndex: number, teamNum: 1 | 2, scorerIdToRemove: string) => {
    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      const currentMatchResult = { ...newResults[matchIndex] };
      let newGoalScorers: ScorerEntry[];

      if (teamNum === 1) {
        newGoalScorers = currentMatchResult.team1GoalScorers.filter(s => s.playerId !== scorerIdToRemove);
        currentMatchResult.team1GoalScorers = newGoalScorers;
      } else {
        newGoalScorers = currentMatchResult.team2GoalScorers.filter(s => s.playerId !== scorerIdToRemove);
        currentMatchResult.team2GoalScorers = newGoalScorers;
      }
      // currentMatchResult.saved = false; // Keep saved status if editing
      currentMatchResult.goalScorerMismatch = false; // Reset mismatch flag
      newResults[matchIndex] = currentMatchResult;
      return newResults;
    });
  }, []);

  // Helper function to apply or revert match stats to teamStats
  const applyMatchStatsToTeams = useCallback((
    stats: TeamStat[],
    match: MatchResult,
    submittedTeams: Team[],
    multiplier: 1 | -1 // 1 for add, -1 for subtract
  ): TeamStat[] => {
    if (typeof match.team1Score !== 'number' || typeof match.team2Score !== 'number') {
      return stats; // Only apply/revert if scores are numbers
    }

    const newStats = [...stats];

    const team1 = submittedTeams.find(t => t.id === match.team1Id);
    const team2 = submittedTeams.find(t => t.id === match.team2Id);

    if (!team1 || !team2) return stats;

    const team1Name = team1.name;
    const team2Name = team2.name;
    const score1 = match.team1Score;
    const score2 = match.team2Score;

    const updateStatEntry = (teamStat: TeamStat, currentScore: number, opponentScore: number, mult: 1 | -1) => {
      teamStat.played += 1 * mult;
      teamStat.gf += currentScore * mult;
      teamStat.ga += opponentScore * mult;
      if (currentScore > opponentScore) { teamStat.wins += 1 * mult; teamStat.points += 3 * mult; }
      else if (currentScore < opponentScore) { teamStat.losses += 1 * mult; }
      else { teamStat.draws += 1 * mult; teamStat.points += 1 * mult; }
      teamStat.gd = teamStat.gf - teamStat.ga; // GD is always gf - ga
    };

    const team1Index = newStats.findIndex(t => t.name === team1Name);
    const team2Index = newStats.findIndex(t => t.name === team2Name);

    if (team1Index > -1) {
      newStats[team1Index] = { ...newStats[team1Index] }; // Create a new object for immutability
      updateStatEntry(newStats[team1Index], score1, score2, multiplier);
    }
    if (team2Index > -1) {
      newStats[team2Index] = { ...newStats[team2Index] }; // Create a new object for immutability
      updateStatEntry(newStats[team2Index], score2, score1, multiplier);
    }
    return newStats;
  }, [submittedTeamData]); // This needs submittedTeamData

  const handleSaveResult = useCallback((matchIndex: number) => {
    const resultToSave = matchResults[matchIndex];
    if (resultToSave.team1Score === '' || resultToSave.team2Score === '') {
      setWarningMessage('لطفاً هر دو امتیاز تیم را وارد کنید.');
      setWarningModalType('alert');
      setShowWarningModal(true);
      return;
    }

    const score1 = Number(resultToSave.team1Score);
    const score2 = Number(resultToSave.team2Score);

    // Validate player goals against team scores if players per team is > 0
    let mismatch = false;
    if (numPlayersPerTeam > 0) {
      const team1GoalsSum = resultToSave.team1GoalScorers.reduce((sum, p) => sum + p.goals, 0);
      const team2GoalsSum = resultToSave.team2GoalScorers.reduce((sum, p) => sum + p.goals, 0);
      if (team1GoalsSum !== score1 || team2GoalsSum !== score2) {
        mismatch = true;
      }
    }

    if (mismatch) {
      setWarningMessage('مجموع گل‌های بازیکنان با امتیاز تیم مطابقت ندارد. لطفاً تصحیح کنید.');
      setWarningModalType('alert');
      setShowWarningModal(true);
      // Do NOT save, but mark the mismatch for UI feedback
      setMatchResults(prevResults => {
        const newResults = [...prevResults];
        newResults[matchIndex] = { ...newResults[matchIndex], goalScorerMismatch: true };
        return newResults;
      });
      return;
    }

    setTeamStats(prevStats => {
      let currentStats = [...prevStats];

      // If this match was previously saved and now being edited
      if (resultToSave.saved && resultToSave.isEditing && resultToSave.originalScores) {
        // Revert stats using the original scores
        const originalMatchDataToRevert: MatchResult = {
          ...resultToSave, // Use current match info for IDs, but original scores
          team1Score: resultToSave.originalScores.team1,
          team2Score: resultToSave.originalScores.team2,
        };
        currentStats = applyMatchStatsToTeams(currentStats, originalMatchDataToRevert, submittedTeamData, -1);
      }

      // Apply stats for the new (or updated) result
      currentStats = applyMatchStatsToTeams(currentStats, resultToSave, submittedTeamData, 1);
      return currentStats;
    });
    
    // Mark the match as saved, exit editing mode, and clear original scores
    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      newResults[matchIndex] = {
        ...newResults[matchIndex],
        saved: true,
        isEditing: false, // Exit editing mode
        originalScores: undefined, // Clear original state
        originalGoalScorers: undefined, // Clear original state
        goalScorerMismatch: false, // Clear mismatch on successful save/update
      };
      
      // After saving, find the next unsaved match and set it as the current view
      const nextUnsavedIndex = findFirstUnsavedMatchIndex(newResults);
      setCurrentMatchViewIndex(nextUnsavedIndex); // This is where we explicitly move to the next unsaved match

      return newResults;
    });

    // Update allPlayedPairs - mark this specific pair as played
    const match = matches[matchIndex]; // match is [team1Name, team2Name]
    const team1Name = match[0];
    const team2Name = match[1];
    const playedPairKey = normalizePair(team1Name, team2Name);
    if (playedPairKey) {
        setAllPlayedPairs(prev => new Set(prev).add(playedPairKey));
    }
  }, [matchResults, matches, normalizePair, numPlayersPerTeam, submittedTeamData, applyMatchStatsToTeams, setWarningMessage, setShowWarningModal, setWarningModalType, findFirstUnsavedMatchIndex]);

  const handleEditResult = useCallback((matchIndex: number) => {
    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      const currentMatch = newResults[matchIndex];
      newResults[matchIndex] = {
        ...currentMatch,
        isEditing: true,
        // Save current saved scores/scorers as 'original' for potential revert/undoing stats
        originalScores: { team1: currentMatch.team1Score, team2: currentMatch.team2Score },
        originalGoalScorers: { team1: [...currentMatch.team1GoalScorers], team2: [...currentMatch.team2GoalScorers] },
        goalScorerMismatch: false, // Reset mismatch when entering edit
      };
      return newResults;
    });
    // Do NOT change currentMatchViewIndex here. Stay on the current match.
  }, []);

  const handleCancelEdit = useCallback((matchIndex: number) => {
    setMatchResults(prevResults => {
      const newResults = [...prevResults];
      const currentMatch = newResults[matchIndex];
      // Revert scores and scorers to original state if we have them, then exit editing mode
      if (currentMatch.originalScores && currentMatch.originalGoalScorers) {
        newResults[matchIndex] = {
          ...currentMatch,
          team1Score: currentMatch.originalScores.team1,
          team2Score: currentMatch.originalScores.team2,
          team1GoalScorers: currentMatch.originalGoalScorers.team1,
          team2GoalScorers: currentMatch.originalGoalScorers.team2,
          isEditing: false,
          originalScores: undefined, // Clear original state
          originalGoalScorers: undefined, // Clear original state
          goalScorerMismatch: false, // Clear mismatch
        };
      } else {
        // If no original state was saved (e.g., bug or initial unsaved match), just exit editing
        newResults[matchIndex] = {
          ...currentMatch,
          isEditing: false,
          goalScorerMismatch: false,
        };
      }
      return newResults;
    });
    // Do NOT change currentMatchViewIndex here. Stay on the current match.
  }, []);

  const sortedTeamStats = useMemo(() => {
    return [...teamStats].sort((a, b) =>
      b.points - a.points || b.gd - a.gd || b.gf - a.gf
    );
  }, [teamStats]);

  // All results are in if all matchResults entries are saved
  const allResultsIn = useMemo(() => matches.length > 0 && matchResults.every(r => r.saved), [matches, matchResults]);

  const areCountsValid = numTeams > 1 && numPlayersPerTeam >= 0; // Minimum 2 teams for a league

  // FIX: Defined resetGameStates function
  const resetGameStates = useCallback(() => {
    setNumTeams(0);
    setNumPlayersPerTeam(0);
    setTeamData([]);
    setSubmittedTeamData([]);
    setMatches([]);
    setMatchResults([]); // This will be reset, so editing states are cleared
    setTeamStats([]);
    setRoundNumber(0); // Reset to inactive
    setAllPlayedPairs(new Set<string>());
    setAppStage('initialScreen');
    setCurrentTeamIndex(0);
    setCurrentLeagueName(null); // Clear the current league name
    globalIdCounter = 0; // Reset the global ID counter
    setActiveLeagueView('matches'); // Reset to default view
    setCurrentMatchViewIndex(0); // Reset current match index
  }, []);

  const handleResetLeague = useCallback(() => {
    if (window.confirm('لیگ به پایان رسیده است. آیا می‌خواهید نتایج را پاک کرده و لیگ جدیدی را شروع کنید؟')) {
      resetGameStates(); // This already handles resetting everything
    }
  }, [resetGameStates]);

  // --- New Handlers for App Stages ---
  const handleStartNewLeague = useCallback(() => {
    resetGameStates(); // Fully reset all game states for a new league
    setAppStage('setupCounts'); // Then set to setup counts
  }, [resetGameStates]);

  const handleContinueLeague = useCallback(() => {
    // If there are no saved leagues, show alert
    if (Object.keys(savedLeagues).length === 0) {
      setWarningMessage('لیگ ذخیره شده‌ای یافت نشد. لطفاً ابتدا یک لیگ جدید ایجاد کنید.');
      setWarningModalType('alert');
      setShowWarningModal(true);
      return;
    }
    setAppStage('loadLeagueOptions'); // Move to a new stage to display saved leagues
  }, [savedLeagues, setWarningMessage, setWarningModalType, setShowWarningModal]);

  const handleGoToNamingStep = useCallback(() => {
    setAppStage('namingTeamsAndPlayers');
    setCurrentTeamIndex(0); // Start naming from the first team
    // Ensure teamData is correctly initialized for naming phase, if not already
    if (teamData.length !== numTeams || (numTeams > 0 && teamData[0]?.players.length !== numPlayersPerTeam)) {
      setTeamData(Array(numTeams).fill(null).map(() => ({
          id: generateUniqueId(),
          name: '',
          players: Array(numPlayersPerTeam).fill(null).map(() => ({ id: generateUniqueId(), name: '' }))
      })));
    }
  }, [numTeams, numPlayersPerTeam, teamData]);


  // This function will contain the logic to actually start the games
  const startTheGames = useCallback((teamsToUse: Team[]) => {
      setSubmittedTeamData(teamsToUse);

      // If fewer than 2 teams are named, we can't start a league
      if (teamsToUse.length < 2) {
        setMatches([]);
        setMatchResults([]);
        // This case should ideally be caught by the warning modal, but defensive check
        return;
      }
      
      setTeamStats(teamsToUse.map(team => ({
        name: team.name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
      })));

      const { newMatches, newMatchResults } = generateAllRoundRobinMatches(teamsToUse);
      setMatches(newMatches);
      setMatchResults(newMatchResults);
      setAllPlayedPairs(new Set<string>()); // Reset played pairs for a new league
      setRoundNumber(1); // Set to active league (round 1)
      setShowWarningModal(false); // Close modal if open
      setWarningModalType('alert'); // Reset modal type after closing
      setActiveLeagueView('matches'); // Ensure matches view is active
      setCurrentMatchViewIndex(0); // For a new league, always start at the first match
  }, [generateAllRoundRobinMatches, setWarningModalType]);


  const handleNextTeam = useCallback(() => {
    if (currentTeamIndex < numTeams - 1) {
      setCurrentTeamIndex(prevIndex => prevIndex + 1);
    }
  }, [currentTeamIndex, numTeams]);

  const handlePreviousTeam = useCallback(() => {
    if (currentTeamIndex > 0) {
      setCurrentTeamIndex(prevIndex => prevIndex - 1);
    }
  }, [currentTeamIndex]);

  // New navigation for single match input view
  const handleNextMatch = useCallback(() => {
    setCurrentMatchViewIndex(prevIndex => Math.min(prevIndex + 1, matches.length - 1));
  }, [matches]);

  const handlePreviousMatch = useCallback(() => {
    setCurrentMatchViewIndex(prevIndex => Math.max(prevIndex - 1, 0));
  }, [matches]);


  const handleStartGamesClick = useCallback(() => {
      let unnamedTeamsCount = 0;
      let unnamedPlayersCount = 0;

      // Identify teams and players that user left unnamed
      for (const team of teamData) {
          if (team.name.trim() === '') {
              unnamedTeamsCount++;
          }
          if (numPlayersPerTeam > 0) {
              unnamedPlayersCount += team.players.filter(p => p.name.trim() === '').length;
          }
      }

      const shouldShowWarning = unnamedTeamsCount > 0 || unnamedPlayersCount > 0;

      if (shouldShowWarning) {
          let message = '';
          if (unnamedTeamsCount > 0) {
              message += `شما ${numTeams} تیم برای نامگذاری مشخص کرده‌اید. ${unnamedTeamsCount} تیم نامگذاری نشده‌اند و به صورت خودکار با نام‌های پیش‌فرض ("تیم ۱", "تیم ۲" و غیره) وارد مسابقات خواهند شد. `;
          }
          if (unnamedPlayersCount > 0) {
              if (unnamedTeamsCount > 0) message += `همچنین، `; // Connect messages if both are present
              message += `تعداد ${unnamedPlayersCount} نام بازیکن خالی است و با نام‌های پیش‌فرض ("بازیکن ۱", "بازیکن ۲" و غیره) پر خواهند شد. `;
          }
          message += `آیا می‌خواهید با همین تنظیمات ادامه دهید؟`;
          setWarningMessage(message);
          setWarningModalType('confirm');
          setShowWarningModal(true);
      } else {
          // All teams and players are named as expected, proceed directly
          // We still need to trim names for consistency
          const finalTeamsToUse = teamData.map((team) => {
              const namedPlayers = team.players.map((player) => ({
                  ...player,
                  name: player.name.trim() // Trim existing names
              }));
              return {
                  ...team,
                  name: team.name.trim(), // Trim existing name
                  players: namedPlayers
              };
          });
          startTheGames(finalTeamsToUse);
      }
  }, [teamData, numTeams, numPlayersPerTeam, startTheGames, setWarningModalType, setShowWarningModal, setWarningMessage]);

  // Function to handle continuing after overall warning (for auto-fill)
  const handleConfirmStartGames = useCallback(() => {
      // Assign default names for both teams and players before starting the games
      const teamsToProceedWith = teamData.map((team, teamIndex) => {
          const namedPlayers = team.players.map((player, playerIndex) => ({
              ...player,
              name: player.name.trim() === '' ? `بازیکن ${playerIndex + 1}` : player.name.trim()
          }));
          return {
              ...team,
              name: team.name.trim() === '' ? `تیم ${teamIndex + 1}` : team.name.trim(),
              players: namedPlayers
          };
      });
      startTheGames(teamsToProceedWith);
  }, [teamData, startTheGames]);

  // Function to handle cancelling after overall warning (for auto-fill)
  const handleCancelStartGames = useCallback(() => {
      setShowWarningModal(false);
      setWarningMessage('');
      setWarningModalType('alert'); // Reset modal type
  }, []);

  const handleDismissAlert = useCallback(() => {
    setShowWarningModal(false);
    setWarningMessage('');
    setWarningModalType('alert'); // Ensure it resets to alert
  }, []);

  const currentTeam = teamData[currentTeamIndex];

  // --- Save/Load League Handlers ---
  const handleSaveLeagueClick = useCallback(() => {
    setShowSaveLeagueModal(true);
    setSaveLeagueInputName(currentLeagueName || ''); // Pre-fill with current name if available
    setShowOverwriteConfirm(false); // Reset overwrite state
  }, [currentLeagueName]);

  const handleSaveLeagueConfirm = useCallback(() => {
    if (saveLeagueInputName.trim() === '') {
      setWarningMessage('لطفاً یک نام برای لیگ وارد کنید.');
      setWarningModalType('alert');
      setShowWarningModal(true);
      return;
    }

    const leagueName = saveLeagueInputName.trim();
    if (savedLeagues[leagueName] && !showOverwriteConfirm) {
      setLeagueNameToOverwrite(leagueName);
      setShowOverwriteConfirm(true);
      return;
    }

    // Construct the state to save
    const stateToSave: SavedLeagueState = {
      numTeams,
      numPlayersPerTeam,
      submittedTeamData,
      matchResults: matchResults.map(m => ({ // Ensure originalScores/isEditing are not saved
        ...m,
        isEditing: false,
        originalScores: undefined,
        originalGoalScorers: undefined,
      })),
      teamStats,
      roundNumber, // roundNumber will be 1 if league is active
      allPlayedPairs: Array.from(allPlayedPairs), // Convert Set to array
      globalIdCounterValue: globalIdCounter,
    };
    
    saveLeagueToStorage(leagueName, stateToSave); // This also updates `savedLeagues` state
    setCurrentLeagueName(leagueName);
    setShowSaveLeagueModal(false);
    setShowOverwriteConfirm(false); // Reset overwrite state
    setSaveLeagueInputName(''); // Clear input
    setWarningMessage(''); // Clear any pending warning
  }, [numTeams, numPlayersPerTeam, submittedTeamData, matchResults, teamStats, roundNumber, allPlayedPairs, saveLeagueToStorage, savedLeagues, saveLeagueInputName, showOverwriteConfirm, currentLeagueName, setWarningMessage, setWarningModalType, setShowWarningModal]);

  const handleCancelSaveLeague = useCallback(() => {
    setShowSaveLeagueModal(false);
    setShowOverwriteConfirm(false); // Reset overwrite state
    setSaveLeagueInputName(''); // Clear input
  }, []);

  const handleLoadLeague = useCallback((leagueName: string) => {
    const leagueToLoad = savedLeagues[leagueName];
    if (leagueToLoad) {
      resetGameStates(); // Reset current active game before loading new one
      setNumTeams(leagueToLoad.numTeams);
      setNumPlayersPerTeam(leagueToLoad.numPlayersPerTeam);
      setSubmittedTeamData(leagueToLoad.submittedTeamData);
      setTeamData(leagueToLoad.submittedTeamData); // Also set teamData during naming phase if user goes back
      
      // Matches are already stored in matchResults, so we just reconstruct matches for display
      const loadedMatches: string[][] = leagueToLoad.matchResults.map(mr => {
          const team1 = leagueToLoad.submittedTeamData.find(t => t.id === mr.team1Id);
          const team2 = leagueToLoad.submittedTeamData.find(t => t.id === mr.team2Id);
          return [team1?.name || 'نامشخص', team2?.name || 'نامشخص']; // No 'استراحت'
      });
      setMatches(loadedMatches);
      const cleanedMatchResults = leagueToLoad.matchResults.map(m => ({ // Clear temporary editing states upon load
        ...m,
        isEditing: false,
        originalScores: undefined,
        originalGoalScorers: undefined,
      }));
      setMatchResults(cleanedMatchResults);
      setTeamStats(leagueToLoad.teamStats);
      setRoundNumber(leagueToLoad.roundNumber); // Will be 1 if league was active
      setAllPlayedPairs(new Set(leagueToLoad.allPlayedPairs));
      globalIdCounter = leagueToLoad.globalIdCounterValue; // Set global counter
      setCurrentLeagueName(leagueName);
      setAppStage(leagueToLoad.roundNumber > 0 ? 'namingTeamsAndPlayers' : 'setupCounts'); // Go to naming, then game view will render if roundNumber > 0
      setActiveLeagueView('matches'); // Default to matches view when loading
      setCurrentMatchViewIndex(findFirstUnsavedMatchIndex(cleanedMatchResults)); // Explicitly set current match view
    }
  }, [savedLeagues, resetGameStates, findFirstUnsavedMatchIndex]);

  const handleDeleteLeague = useCallback((leagueName: string) => {
    if (window.confirm(`آیا مطمئن هستید که می‌خواهید لیگ "${leagueName}" را حذف کنید؟ این عمل قابل بازگشت نیست.`)) {
      deleteLeagueFromStorage(leagueName);
      if (currentLeagueName === leagueName) {
        setCurrentLeagueName(null); // Clear current league if deleted
        resetGameStates(); // Also reset game states if the active league was deleted
      }
      setAppStage('initialScreen'); // Go back to initial screen regardless of which league was deleted
    }
  }, [deleteLeagueFromStorage, currentLeagueName, resetGameStates]);

  const handleExitLeague = useCallback(() => {
    console.log('handleExitLeague called');
    if (window.confirm('آیا مطمئن هستید که می‌خواهید از لیگ فعلی خارج شوید؟ تمام نتایج ذخیره نشده از بین خواهند رفت.')) {
      console.log('User confirmed exit. Resetting game states and setting appStage to initialScreen.');
      resetGameStates(); // Resets game states and currentLeagueName, and now appStage
      console.log('After reset: appStage:', 'initialScreen', 'roundNumber (should be 0):', 0);
    } else {
      console.log('User cancelled exit.');
    }
  }, [resetGameStates]);

  // FIX: handleNumTeamsChange function
  const handleNumTeamsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 0) {
      setNumTeams(value);
      // Reset teamData if number of teams changes, to avoid stale data
      setTeamData(Array(value).fill(null).map(() => ({
        id: generateUniqueId(),
        name: '',
        players: Array(numPlayersPerTeam).fill(null).map(() => ({ id: generateUniqueId(), name: '' }))
      })));
    } else if (e.target.value === '') {
      setNumTeams(0);
      setTeamData([]);
    }
  }, [numPlayersPerTeam]);

  // FIX: handleNumPlayersPerTeamChange function
  const handleNumPlayersPerTeamChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 0) {
      setNumPlayersPerTeam(value);
      // Update players in existing teamData or initialize for new teams
      setTeamData(prevTeamData => prevTeamData.map(team => ({
        ...team,
        players: Array(value).fill(null).map((_, i) => team.players[i] || { id: generateUniqueId(), name: '' })
      })));
    } else if (e.target.value === '') {
      setNumPlayersPerTeam(0);
      // Clear players from existing teamData
      setTeamData(prevTeamData => prevTeamData.map(team => ({
        ...team,
        players: []
      })));
    }
  }, []);

  // FIX: handleTeamNameChange function
  const handleTeamNameChange = useCallback((teamIndex: number, newName: string) => {
    setTeamData(prevTeamData => {
      const newTeamData = [...prevTeamData];
      newTeamData[teamIndex] = { ...newTeamData[teamIndex], name: newName };
      return newTeamData;
    });
  }, []);

  // FIX: handlePlayerNameChange function
  const handlePlayerNameChange = useCallback((teamIndex: number, playerIndex: number, newName: string) => {
    setTeamData(prevTeamData => {
      const newTeamData = [...prevTeamData];
      const newPlayers = [...newTeamData[teamIndex].players];
      newPlayers[playerIndex] = { ...newPlayers[playerIndex], name: newName };
      newTeamData[teamIndex] = { ...newTeamData[teamIndex], players: newPlayers };
      return newTeamData;
    });
  }, []);

  // Calculate top scorers based on match results
  const calculateTopScorers = useMemo(() => {
    const playerGoals: { [playerId: string]: { name: string; goals: number; teamName: string; } } = {};

    matchResults.forEach(match => {
      // Team 1 scorers
      match.team1GoalScorers.forEach(scorer => {
        const team1 = submittedTeamData.find(t => t.id === match.team1Id);
        const teamName = team1 ? team1.name : 'Unknown Team';
        if (playerGoals[scorer.playerId]) {
          playerGoals[scorer.playerId].goals += scorer.goals;
        } else {
          playerGoals[scorer.playerId] = { name: scorer.playerName, goals: scorer.goals, teamName };
        }
      });
      // Team 2 scorers
      match.team2GoalScorers.forEach(scorer => {
        const team2 = submittedTeamData.find(t => t.id === match.team2Id);
        const teamName = team2 ? team2.name : 'Unknown Team';
        if (playerGoals[scorer.playerId]) {
          playerGoals[scorer.playerId].goals += scorer.goals;
        } else {
          playerGoals[scorer.playerId] = { name: scorer.playerName, goals: scorer.goals, teamName };
        }
      });
    });

    const sortedScorers = Object.values(playerGoals).sort((a, b) => b.goals - a.goals);
    return sortedScorers;
  }, [matchResults, submittedTeamData]);

  // Log appStage and roundNumber on every render for debugging
  console.log('App render: appStage =', appStage, ', roundNumber =', roundNumber);

  // Handlers for switching league views
  const handleShowMatchInput = useCallback(() => {
    setActiveLeagueView('matches');
  }, []);

  const handleShowTopScorers = useCallback(() => {
    setActiveLeagueView('topScorers');
  }, []);

  const handleShowMatchResultsSummary = useCallback(() => {
    setActiveLeagueView('matchResultsSummary');
  }, []);

  // --- Initial Screen ---
  if (roundNumber === 0 && appStage === 'initialScreen') {
    return (
      <div className="flex flex-col items-center justify-center w-full max-w-lg bg-white shadow-lg rounded-xl p-6 sm:p-8 md:p-10">
        <div className="text-center w-full max-w-md">
          <h1 className="text-3xl font-bold text-indigo-600 mb-4">
            مدیریت لیگ
          </h1>
          <p className="text-gray-600 mb-8">
            به لیگ خوش آمدید
          </p>
          <div className="space-y-4">
            <button
              onClick={handleStartNewLeague}
              className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              aria-label="شروع لیگ جدید"
            >
              شروع لیگ جدید
            </button>
            <button
              onClick={handleContinueLeague}
              className="w-full py-3 bg-slate-700 text-white font-semibold rounded-lg shadow-md hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
              aria-label="ادامه لیگ"
            >
              ادامه لیگ
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Application View (Post-Initial Screen) ---
  return (
    <div className="flex flex-col items-center w-full max-w-screen-2xl bg-white shadow-lg rounded-xl p-6 sm:p-8 md:p-10 pb-28 relative">
      <header className="w-full mb-8 text-center border-b pb-4 flex flex-col sm:flex-row items-center justify-center sm:justify-between">
        {/* Buttons visible when a league is active - Moved to the left (start) */}
        {roundNumber > 0 && ( 
          <div className="flex gap-2 mt-4 sm:mt-0">
            <button
              onClick={handleSaveLeagueClick}
              className="py-2 px-4 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 transition duration-200 ease-in-out text-sm"
              aria-label="ذخیره لیگ"
            >
              ذخیره لیگ
            </button>
            <button
              onClick={handleExitLeague}
              className="py-2 px-4 bg-red-500 text-white font-semibold rounded-lg shadow-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 transition duration-200 ease-in-out text-sm"
              aria-label="خروج از لیگ"
            >
              خروج از لیگ
            </button>
          </div>
        )}
        {/* Title for the league if active, positioned within the header - Moved to the right (end) */}
        {currentLeagueName && roundNumber > 0 && (
          <span className="mt-2 sm:mt-0 text-xl font-semibold text-gray-700">
            {currentLeagueName}
          </span>
        )}
      </header>

      {/* Single "مدیریت لیگ" title with conditional styling and rendering */}
      {roundNumber > 0 ? (
        // Case: League in progress, title below header
        <h1 className="text-2xl sm:text-3xl font-bold text-indigo-700 mt-4 mb-8 text-center">
          مدیریت لیگ
        </h1>
      ) : (
        // Case: Before league starts, during setup/naming, large title
        (appStage === 'setupCounts' || appStage === 'namingTeamsAndPlayers') && (
          <h1 className="text-3xl sm:text-4xl font-extrabold text-indigo-700 tracking-tight mb-8">
            مدیریت لیگ
          </h1>
        )
      )}

      {/* --- Load League Options Screen --- */}
      {roundNumber === 0 && appStage === 'loadLeagueOptions' && (
        <section className="w-full max-w-2xl mx-auto mb-8 space-y-6 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">لیگ‌های ذخیره شده:</h2>
          {Object.keys(savedLeagues).length === 0 ? (
            <p className="text-gray-600">هیچ لیگی ذخیره نشده است.</p>
          ) : (
            <ul className="space-y-3 max-w-xl mx-auto">
              {Object.entries(savedLeagues).map(([name, league]: [string, SavedLeagueState]) => (
                <li key={name} className="flex flex-col sm:flex-row items-center justify-between bg-gray-100 p-3 rounded-lg shadow-sm border border-gray-200">
                  <span className="font-medium text-gray-700 text-lg mb-2 sm:mb-0 text-right">{name} (دور: {league.roundNumber > 0 ? 'فعال' : 'ناتمام'})</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleLoadLeague(name)}
                      className="py-2 px-4 bg-green-500 text-white text-sm rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400"
                      aria-label={`بارگذاری لیگ ${name}`}
                    >
                      بارگذاری
                    </button>
                    <button
                      onClick={() => handleDeleteLeague(name)}
                      className="py-2 px-4 bg-red-500 text-white text-sm rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400"
                      aria-label={`حذف لیگ ${name}`}
                    >
                      حذف
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setAppStage('initialScreen')}
            className="mt-8 py-3 px-6 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg"
            aria-label="بازگشت به صفحه اصلی"
          >
            بازگشت
          </button>
        </section>
      )}


      {/* --- Setup Counts Screen --- */}
      {roundNumber === 0 && appStage === 'setupCounts' && (
        <section className="w-full mb-8 space-y-6 max-w-xl mx-auto">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label htmlFor="numTeams" className="block text-lg font-medium text-gray-800 mb-2">
                تعداد تیم‌ها:
              </label>
              <input
                id="numTeams"
                type="number"
                min="2"
                value={numTeams === 0 ? '' : numTeams}
                onChange={handleNumTeamsChange}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-center text-lg"
                placeholder="حداقل 2"
                aria-label="تعداد تیم‌ها"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="numPlayersPerTeam" className="block text-lg font-medium text-gray-800 mb-2">
                تعداد بازیکنان در هر تیم:
              </label>
              <input
                id="numPlayersPerTeam"
                type="number"
                min="0"
                value={numPlayersPerTeam === 0 ? '' : numPlayersPerTeam}
                onChange={(e) => handleNumPlayersPerTeamChange(e)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 ease-in-out text-center text-lg"
                placeholder="مثلاً 5"
                aria-label="تعداد بازیکنان در هر تیم"
              />
            </div>
          </div>
          <button
            onClick={handleGoToNamingStep}
            disabled={!areCountsValid}
            className="w-full py-3 px-6 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="بعدی"
          >
            بعدی
          </button>
          <button
            onClick={() => setAppStage('initialScreen')}
            className="w-full py-3 px-6 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg"
            aria-label="بازگشت به صفحه اصلی"
          >
            بازگشت
          </button>
        </section>
      )}

      {/* --- Naming Teams & Players Screen --- */}
      {roundNumber === 0 && appStage === 'namingTeamsAndPlayers' && currentTeam && (
        <section className="w-full mb-4">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
            نامگذاری تیم {currentTeamIndex + 1} از {numTeams}
          </h2>
          <div className="space-y-6">
            <div key={currentTeam.id} className="bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="mb-4">
                <label htmlFor={`teamName-${currentTeam.id}`} className="block text-sm font-medium text-gray-700 mb-1">
                  نام تیم:
                </label>
                <input
                  id={`teamName-${currentTeam.id}`}
                  type="text"
                  value={currentTeam.name}
                  onChange={(e) => handleTeamNameChange(currentTeamIndex, e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 text-base"
                  placeholder={`نام تیم ${currentTeamIndex + 1}`}
                  aria-label={`نام تیم ${currentTeamIndex + 1}`}
                />
              </div>
              {numPlayersPerTeam > 0 && (
                <div className="ml-4 mt-2 border-t pt-4 border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">بازیکنان تیم {currentTeam.name || `تیم ${currentTeamIndex + 1}`}:</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentTeam.players.map((player, playerIndex) => (
                      <div key={player.id} className="flex flex-col">
                        <label htmlFor={`player-${currentTeam.id}-${player.id}`} className="block text-sm font-medium text-gray-600 mb-1">
                          بازیکن {playerIndex + 1}:
                        </label>
                        <input
                          id={`player-${currentTeam.id}-${player.id}`}
                          type="text"
                          value={player.name}
                          onChange={(e) => handlePlayerNameChange(currentTeamIndex, playerIndex, e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 text-base"
                          placeholder={`نام بازیکن ${playerIndex + 1}`}
                          aria-label={`نام بازیکن ${playerIndex + 1} برای تیم ${currentTeam.name}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-center mt-6 mb-4"> {/* Added margin bottom to push fixed bar down slightly */}
            <button
              onClick={() => setAppStage('setupCounts')}
              className="w-full max-w-xs py-3 px-6 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg"
              aria-label="بازگشت به تنظیمات"
            >
              بازگشت به تنظیمات
            </button>
          </div>
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-sm border-t border-gray-200 flex justify-center gap-4">
            <button
              onClick={handlePreviousTeam}
              disabled={currentTeamIndex === 0}
              className="w-full max-w-xs py-3 px-6 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="تیم قبلی"
            >
              تیم قبلی
            </button>
            {currentTeamIndex < numTeams - 1 ? (
              <button
                onClick={handleNextTeam}
                className="w-full max-w-xs py-3 px-6 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg"
                aria-label="تیم بعدی"
              >
                تیم بعدی
              </button>
            ) : (
              <button
                onClick={handleStartGamesClick}
                className="w-full max-w-xs py-3 px-6 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg"
                aria-label="شروع بازی‌ها"
              >
                شروع بازی‌ها
              </button>
            )}
          </div>
        </section>
      )}

      {/* --- League In Progress (Standings) --- */}
      {roundNumber > 0 && ( 
        <section className="w-full mt-4 pt-6 border-t border-gray-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">جدول رده‌بندی</h2>
            <div className="overflow-x-auto rounded-lg shadow-md">
                 <table className="min-w-full divide-y divide-gray-200 text-center">
                    <thead className="bg-gray-800 text-white">
                        <tr>
                            <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider">#</th>
                            <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-right">نام تیم</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Played">P</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Wins">W</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Draws">D</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Losses">L</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Goals For">GF</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Goals Against">GA</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Goal Difference">GD</th>
                            <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider" title="Points">Pts</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {sortedTeamStats.map((team, index) => (
                            <tr key={team.name} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{index + 1}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800 text-right">{team.name}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-600">{team.played}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">{team.wins}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-yellow-600 font-semibold">{team.draws}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-red-600 font-semibold">{team.losses}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-600">{team.gf}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-600">{team.ga}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">{team.gd}</td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-indigo-700 font-extrabold">{team.points}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
      )}

      {/* --- View Selector Buttons (Matches, Match Results Summary, Top Scorers) --- */}
      {roundNumber > 0 && (
        <div className="flex justify-center flex-wrap gap-4 mt-6 mb-8">
            <button
                onClick={handleShowMatchInput}
                className={`py-3 px-6 rounded-lg shadow-md font-semibold text-lg transition duration-200 ease-in-out ${
                    activeLeagueView === 'matches' ? 'bg-indigo-600 text-white' : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
                }`}
                aria-label="مسابقات"
            >
                مسابقات
            </button>
            <button
                onClick={handleShowMatchResultsSummary}
                className={`py-3 px-6 rounded-lg shadow-md font-semibold text-lg transition duration-200 ease-in-out ${
                    activeLeagueView === 'matchResultsSummary' ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
                }`}
                aria-label="نتایج بازی ها"
            >
                نتایج بازی ها
            </button>
            {numPlayersPerTeam > 0 && ( // Only show if players are tracked
                <button
                    onClick={handleShowTopScorers}
                    className={`py-3 px-6 rounded-lg shadow-md font-semibold text-lg transition duration-200 ease-in-out ${
                        activeLeagueView === 'topScorers' ? 'bg-purple-600 text-white' : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
                    }`}
                    aria-label="گلزنان لیگ"
                >
                    گلزنان لیگ
                </button>
            )}
        </div>
      )}

      {/* --- Match Input Section (single match at a time) --- */}
      {roundNumber > 0 && activeLeagueView === 'matches' && matches.length > 0 && (
        <section className="w-full mt-4 pt-6 border-t border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">ورود نتایج مسابقه</h2>
          <div className="list-none space-y-4 text-gray-700 text-lg">
            {(() => {
              const index = currentMatchViewIndex;
              const match = matches[index];
              const team1 = submittedTeamData.find(t => t.name === match[0]);
              const team2 = submittedTeamData.find(t => t.name === match[1]); 
              const matchResult = matchResults[index];

              const team1ScoreValue = typeof matchResult.team1Score === 'number' ? matchResult.team1Score : 0;
              const team2ScoreValue = typeof matchResult.team2Score === 'number' ? matchResult.team2Score : 0;

              const team1GoalsSum = matchResult.team1GoalScorers.reduce((sum, p) => sum + p.goals, 0);
              const team2GoalsSum = matchResult.team2GoalScorers.reduce((sum, p) => sum + p.goals, 0);

              const showTeam1ScorerDropdown = numPlayersPerTeam > 0 && (!matchResult.saved || matchResult.isEditing) && team1ScoreValue > 0 && team1GoalsSum < team1ScoreValue;
              const showTeam2ScorerDropdown = numPlayersPerTeam > 0 && (!matchResult.saved || matchResult.isEditing) && team2ScoreValue > 0 && team2GoalsSum < team2ScoreValue;

              return (
                <div key={index} className={`bg-gray-50 p-4 rounded-lg shadow-sm border ${matchResults[index]?.goalScorerMismatch ? 'border-red-500 ring-2 ring-red-500' : 'border-gray-200'} flex flex-col justify-between gap-4`}>
                    <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{match[0]}</span>
                        <input
                          type="number"
                          min="0"
                          value={String(matchResults[index].team1Score)}
                          onChange={(e) => handleScoreChange(index, 'team1', e.target.value)}
                          className="w-16 p-2 border border-gray-300 rounded-md text-center text-base focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300"
                          disabled={!matchResult.isEditing && matchResult.saved}
                          aria-label={`امتیاز برای ${match[0]}`}
                        />
                      </div>
                      <span className="font-bold text-gray-600 text-base mx-2">در مقابل</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{match[1]}</span>
                        <input
                          type="number"
                          min="0"
                          value={String(matchResults[index].team2Score)}
                          onChange={(e) => handleScoreChange(index, 'team2', e.target.value)}
                          className="w-16 p-2 border border-gray-300 rounded-md text-center text-base focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300"
                          disabled={!matchResult.isEditing && matchResult.saved}
                          aria-label={`امتیاز برای ${match[1]}`}
                        />
                      </div>
                    </div>

                    {numPlayersPerTeam > 0 && (
                      <div className="flex flex-col md:flex-row justify-around gap-6 mt-4 pt-4 border-t border-gray-200 text-sm">
                        {/* Team 1 Goal Scorers */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-700 mb-2 text-center">{match[0]} - گلزنان:</h4>
                          {team1 && showTeam1ScorerDropdown && (
                            <div className="flex flex-col gap-2 mb-4">
                              <select
                                onChange={(e) => handleSelectGoalScorer(index, 1, e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 text-base"
                                disabled={!matchResult.isEditing && matchResult.saved}
                                value="" // Ensure the dropdown resets to "انتخاب بازیکن"
                                aria-label={`انتخاب بازیکن برای ${match[0]}`}
                              >
                                <option value="">انتخاب بازیکن</option>
                                {team1.players.map(player => (
                                  <option key={player.id} value={player.id} disabled={matchResults[index].team1GoalScorers.some(s => s.playerId === player.id)}>
                                    {player.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="flex flex-col gap-2">
                            {matchResults[index].team1GoalScorers.map((playerGoal, scorerIndex) => (
                              <div key={playerGoal.playerId} className="flex items-center justify-between gap-2 p-2 bg-gray-100 rounded-md">
                                <span className="text-gray-700 truncate">{playerGoal.playerName}</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={String(playerGoal.goals)}
                                  onChange={(e) => handlePlayerGoalChange(index, 1, scorerIndex, e.target.value)}
                                  className="w-14 p-1 border border-gray-300 rounded-md text-center text-sm"
                                  disabled={!matchResult.isEditing && matchResult.saved}
                                  aria-label={`گل‌های ${playerGoal.playerName} در تیم ${match[0]}`}
                                />
                                {(!matchResults[index].saved || matchResults[index].isEditing) && (
                                  <button
                                    onClick={() => handleRemoveGoalScorer(index, 1, playerGoal.playerId)}
                                    className="text-red-500 hover:text-red-700 p-1"
                                    aria-label={`حذف ${playerGoal.playerName}`}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Team 2 Goal Scorers */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-700 mb-2 text-center">{match[1]} - گلزنان:</h4>
                          {team2 && showTeam2ScorerDropdown && (
                            <div className="flex flex-col gap-2 mb-4">
                              <select
                                onChange={(e) => handleSelectGoalScorer(index, 2, e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 text-base"
                                disabled={!matchResult.isEditing && matchResult.saved}
                                value="" // Ensure the dropdown resets to "انتخاب بازیکن"
                                aria-label={`انتخاب بازیکن برای ${match[1]}`}
                              >
                                <option value="">انتخاب بازیکن</option>
                                {team2.players.map(player => (
                                  <option key={player.id} value={player.id} disabled={matchResults[index].team2GoalScorers.some(s => s.playerId === player.id)}>
                                    {player.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div className="flex flex-col gap-2">
                            {matchResults[index].team2GoalScorers.map((playerGoal, scorerIndex) => (
                              <div key={playerGoal.playerId} className="flex items-center justify-between gap-2 p-2 bg-gray-100 rounded-md">
                                <span className="text-gray-700 truncate">{playerGoal.playerName}</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={String(playerGoal.goals)}
                                  onChange={(e) => handlePlayerGoalChange(index, 2, scorerIndex, e.target.value)}
                                  className="w-14 p-1 border border-gray-300 rounded-md text-center text-sm"
                                  disabled={!matchResult.isEditing && matchResult.saved}
                                  aria-label={`گل‌های ${playerGoal.playerName} در تیم ${match[1]}`}
                                />
                                {(!matchResults[index].saved || matchResults[index].isEditing) && (
                                  <button
                                    onClick={() => handleRemoveGoalScorer(index, 2, playerGoal.playerId)}
                                    className="text-red-500 hover:text-red-700 p-1"
                                    aria-label={`حذف ${playerGoal.playerName}`}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex justify-center gap-2 mt-4 self-center w-full sm:w-auto">
                        {!matchResult.saved || matchResult.isEditing ? (
                            <button
                                onClick={() => handleSaveResult(index)}
                                disabled={matchResults[index].team1Score === '' || matchResults[index].team2Score === ''}
                                className={`py-2 px-4 rounded-md font-semibold text-sm transition duration-150 ease-in-out w-full sm:w-auto ${
                                    matchResult.saved && matchResult.isEditing
                                      ? 'bg-blue-500 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2' // Update button style
                                      : 'bg-indigo-500 text-white hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2' // Save button style
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                                aria-label={matchResult.saved && matchResult.isEditing ? "بروزرسانی نتیجه" : "ذخیره نتیجه"}
                            >
                                {matchResult.saved && matchResult.isEditing ? 'بروزرسانی' : 'ذخیره'}
                            </button>
                        ) : (
                            <button
                                onClick={() => handleEditResult(index)}
                                className="py-2 px-4 rounded-md font-semibold text-sm transition duration-150 ease-in-out w-full sm:w-auto bg-yellow-500 text-white hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2"
                                aria-label="ویرایش نتیجه"
                            >
                                ویرایش
                            </button>
                        )}
                        {matchResult.isEditing && (
                            <button
                                onClick={() => handleCancelEdit(index)}
                                className="py-2 px-4 rounded-md font-semibold text-sm transition duration-150 ease-in-out w-full sm:w-auto bg-gray-500 text-white hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                                aria-label="لغو ویرایش"
                            >
                                لغو
                            </button>
                        )}
                    </div>
                </div>
              );
            })()}
          </div>
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-sm border-t border-gray-200 flex justify-center gap-4">
              <button
                  onClick={handlePreviousMatch}
                  disabled={currentMatchViewIndex === 0}
                  className="w-full max-w-[150px] py-3 px-6 bg-gray-300 text-gray-800 font-semibold rounded-lg shadow-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="مسابقه قبلی"
              >
                  مسابقه قبلی
              </button>
              <button
                  onClick={handleNextMatch}
                  disabled={currentMatchViewIndex === matches.length - 1}
                  className="w-full max-w-[150px] py-3 px-6 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="مسابقه بعدی"
              >
                  مسابقه بعدی
              </button>
              {allResultsIn && (
                <button
                  onClick={handleResetLeague}
                  className="w-full max-w-[150px] py-3 px-6 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-200 ease-in-out text-lg"
                  aria-label="شروع از اول"
                >
                  شروع از اول
                </button>
              )}
            </div>
        </section>
      )}

      {/* --- League Match Results Summary Section --- */}
      {roundNumber > 0 && activeLeagueView === 'matchResultsSummary' && (
        <section className="w-full mt-4 pt-6 border-t border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">نتایج بازی ها</h2>
          <div className="overflow-x-auto rounded-lg shadow-md">
            <table className="min-w-full divide-y divide-gray-200 text-center">
                <thead className="bg-gray-800 text-white">
                    <tr>
                        <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider">مسابقه</th>
                        <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider">نتیجه</th>
                        <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider">وضعیت</th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {matches.map((match, index) => {
                        const result = matchResults[index];
                        return (
                            <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {match[0]} - {match[1]}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                    {result.saved ? `${result.team1Score} - ${result.team2Score}` : 'N/A'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                    {result.saved ? (
                                        <span className="text-green-600 font-semibold">ذخیره شده</span>
                                    ) : (
                                        <span className="text-yellow-600 font-semibold">ذخیره نشده</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- League Top Scorers Section --- */}
      {roundNumber > 0 && activeLeagueView === 'topScorers' && (
        <section className="w-full mt-4 pt-6 border-t border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">گلزنان برتر لیگ</h2>
          <div className="overflow-x-auto rounded-lg shadow-md mb-6">
            <table className="min-w-full divide-y divide-gray-200 text-center">
              <thead className="bg-gray-800 text-white">
                <tr>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider">رتبه</th>
                  <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-right">نام بازیکن</th>
                  <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-right">تیم</th>
                  <th className="px-3 py-3 text-xs font-medium uppercase tracking-wider">گل‌ها</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {calculateTopScorers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-sm text-gray-500">
                      هنوز گلی به ثمر نرسیده است.
                    </td>
                  </tr>
                ) : (
                  calculateTopScorers.map((scorer, index) => (
                    <tr key={scorer.name + index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{index + 1}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800 text-right">{scorer.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">{scorer.teamName}</td>
                      <td className="px-3 py-4 whitespace-nowrap text-sm text-indigo-700 font-extrabold">{scorer.goals}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}


      {/* Warning Modal (can be for auto-fill confirmation or general alerts) */}
      {showWarningModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
            <h3 className="text-xl font-bold text-red-700 mb-4">هشدار</h3>
            <p className="text-gray-700 mb-6">{warningMessage}</p>
            <div className="flex justify-center gap-4">
              {warningModalType === 'confirm' ? (
                <>
                  <button
                    onClick={handleConfirmStartGames}
                    className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                    aria-label="ادامه بده"
                  >
                    ادامه بده
                  </button>
                  <button
                    onClick={handleCancelStartGames}
                    className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                    aria-label="لغو"
                  >
                    لغو
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDismissAlert}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                  aria-label="باشه"
                >
                  باشه
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save League Modal */}
      {showSaveLeagueModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
            <h3 className="text-xl font-bold text-indigo-700 mb-4">ذخیره لیگ</h3>
            {showOverwriteConfirm ? (
              <>
                <p className="text-gray-700 mb-6">لیگی با نام "<span className="font-bold">{leagueNameToOverwrite}</span>" از قبل وجود دارد. آیا می‌خواهید آن را بازنویسی کنید؟</p>
                <div className="flex justify-center gap-4">
                  <button
                    onClick={handleSaveLeagueConfirm} // This will re-trigger with showOverwriteConfirm=true
                    className="px-6 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 transition duration-150 ease-in-out"
                    aria-label="بازنویسی"
                  >
                    بازنویسی
                  </button>
                  <button
                    onClick={handleCancelSaveLeague}
                    className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                    aria-label="لغو"
                  >
                    لغو
                  </button>
                </div>
              </>
            ) : (
              <>
                <label htmlFor="saveLeagueName" className="block text-sm font-medium text-gray-700 mb-2 text-right">
                  نام لیگ:
                </label>
                <input
                  id="saveLeagueName"
                  type="text"
                  value={saveLeagueInputName}
                  onChange={(e) => setSaveLeagueInputName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 text-base mb-6"
                  placeholder="نام لیگ را وارد کنید"
                  aria-label="نام لیگ برای ذخیره"
                />
                <div className="flex justify-center gap-4">
                  <button
                    onClick={handleSaveLeagueConfirm}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                    aria-label="ذخیره"
                  >
                    ذخیره
                  </button>
                  <button
                    onClick={handleCancelSaveLeague}
                    className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                    aria-label="لغو"
                  >
                    لغو
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;