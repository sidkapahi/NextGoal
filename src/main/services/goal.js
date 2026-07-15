'use strict'

// Goal = starting goal, bumped by the increment for every tier already passed.
// hit 5 -> 10, hit 10 -> 15, etc. Works for any start/step.
function computeGoal(count, startGoal, increment) {
  const start = Math.max(1, startGoal | 0)
  const step = Math.max(1, increment | 0)
  let goal = start
  while (count >= goal) goal += step
  return goal
}

module.exports = { computeGoal }
