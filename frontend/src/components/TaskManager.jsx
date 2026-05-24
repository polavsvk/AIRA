import React, { useState, useEffect } from 'react'
import { CheckSquare, Plus, Trash2, Circle, CheckCircle2, Flag, Calendar } from 'lucide-react'
import axios from 'axios'

const PRIORITY_COLORS = {
  high: 'text-red-400 border-red-400/30 bg-red-400/5',
  medium: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  low: 'text-green-400 border-green-400/30 bg-green-400/5',
}

const PRIORITY_LABELS = { high: 'HIGH', medium: 'MED', low: 'LOW' }

export default function TaskManager() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium', due_date: '' })

  const fetchTasks = async () => {
    try {
      const res = await axios.get('/api/tasks/')
      setTasks(res.data)
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTasks() }, [])

  const createTask = async (e) => {
    e.preventDefault()
    if (!newTask.title.trim()) return
    try {
      const res = await axios.post('/api/tasks/', newTask)
      setTasks([res.data, ...tasks])
      setNewTask({ title: '', description: '', priority: 'medium', due_date: '' })
      setShowForm(false)
    } catch (err) {
      console.error('Failed to create task:', err)
    }
  }

  const toggleTask = async (id) => {
    try {
      const res = await axios.patch(`/api/tasks/${id}/toggle`)
      setTasks(tasks.map(t => t.id === id ? res.data : t))
    } catch (err) {
      console.error('Failed to toggle task:', err)
    }
  }

  const deleteTask = async (id) => {
    try {
      await axios.delete(`/api/tasks/${id}`)
      setTasks(tasks.filter(t => t.id !== id))
    } catch (err) {
      console.error('Failed to delete task:', err)
    }
  }

  const pending = tasks.filter(t => !t.completed)
  const completed = tasks.filter(t => t.completed)

  return (
    <div className="aira-panel p-4 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-aira-blue" />
          <span className="text-xs font-mono text-aira-text-dim tracking-widest">TASKS</span>
          <span className="text-xs bg-aira-blue/10 text-aira-blue border border-aira-blue/20 px-1.5 py-0.5 rounded font-mono">
            {pending.length}
          </span>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="w-6 h-6 flex items-center justify-center rounded border border-aira-border text-aira-text-dim hover:border-aira-blue hover:text-aira-blue transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Add Task Form */}
      {showForm && (
        <form onSubmit={createTask} className="mb-3 space-y-2 flex-shrink-0 animate-fadeIn">
          <input
            value={newTask.title}
            onChange={e => setNewTask({ ...newTask, title: e.target.value })}
            placeholder="Task title..."
            className="aira-input w-full text-xs"
            autoFocus
          />
          <input
            value={newTask.description}
            onChange={e => setNewTask({ ...newTask, description: e.target.value })}
            placeholder="Description (optional)"
            className="aira-input w-full text-xs"
          />
          <div className="flex gap-2">
            <select
              value={newTask.priority}
              onChange={e => setNewTask({ ...newTask, priority: e.target.value })}
              className="aira-input text-xs flex-1"
            >
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
            <input
              type="date"
              value={newTask.due_date}
              onChange={e => setNewTask({ ...newTask, due_date: e.target.value })}
              className="aira-input text-xs flex-1"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="aira-btn-primary text-xs flex-1">Add Task</button>
            <button type="button" onClick={() => setShowForm(false)} className="aira-btn-ghost text-xs flex-1">Cancel</button>
          </div>
        </form>
      )}

      {/* Task List */}
      <div className="overflow-y-auto flex-1 space-y-1.5">
        {loading ? (
          <div className="text-center text-aira-text-dim text-xs py-4">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-6">
            <CheckSquare className="w-8 h-8 text-aira-border mx-auto mb-2" />
            <p className="text-xs text-aira-text-dim">No tasks yet, Mr. V.</p>
            <p className="text-xs text-aira-text-dim">Tap + to add your first task.</p>
          </div>
        ) : (
          <>
            {/* Pending Tasks */}
            {pending.map(task => (
              <div key={task.id} className="group flex items-start gap-2 p-2 rounded-lg hover:bg-aira-darker transition-colors">
                <button onClick={() => toggleTask(task.id)} className="mt-0.5 text-aira-text-dim hover:text-aira-blue transition-colors flex-shrink-0">
                  <Circle className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-aira-text leading-relaxed">{task.title}</span>
                    <span className={`text-xs px-1 py-0.5 rounded border font-mono ${PRIORITY_COLORS[task.priority]}`}>
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-xs text-aira-text-dim mt-0.5 line-clamp-1">{task.description}</p>
                  )}
                  {task.due_date && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Calendar className="w-2.5 h-2.5 text-aira-text-dim" />
                      <span className="text-xs text-aira-text-dim">{task.due_date}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => deleteTask(task.id)}
                  className="opacity-0 group-hover:opacity-100 text-aira-text-dim hover:text-red-400 transition-all flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Completed Tasks */}
            {completed.length > 0 && (
              <>
                <div className="border-t border-aira-border my-2" />
                <p className="text-xs text-aira-text-dim font-mono px-1">COMPLETED ({completed.length})</p>
                {completed.map(task => (
                  <div key={task.id} className="group flex items-start gap-2 p-2 rounded-lg hover:bg-aira-darker transition-colors opacity-50">
                    <button onClick={() => toggleTask(task.id)} className="mt-0.5 text-aira-green flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-aira-text line-through">{task.title}</span>
                    </div>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="opacity-0 group-hover:opacity-100 text-aira-text-dim hover:text-red-400 transition-all flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
