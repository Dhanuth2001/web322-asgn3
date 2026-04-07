
require("dotenv").config();

const express = require("express");
const clientSessions = require("client-sessions");
const path = require("path");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const pg = require("pg");
const { Sequelize, DataTypes } = require("sequelize");

const app = express();

// ======================
// MIDDLEWARE
// ======================

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  clientSessions({
    cookieName: "session",
    secret: process.env.SESSION_SECRET,
    duration: 30 * 60 * 1000,
    activeDuration: 5 * 60 * 1000,
  })
);

// Make user available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.title = "Task Manager";
  next();
});

// EJS
app.set("view engine", "ejs");
app.set("views", __dirname + "/views");

// ======================
// DATABASE CONNECTIONS
// ======================

// MongoDB (Users)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// PostgreSQL (Tasks)
const sequelize = new Sequelize(process.env.PG_URI, {
  logging: false
});

sequelize.sync()
  .then(() => console.log("PostgreSQL Connected"))
  .catch(err => console.log(err));

// ======================
// MODELS
// ======================

// MongoDB User Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

// PostgreSQL Task Model
const Task = sequelize.define("Task", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: DataTypes.TEXT,
  dueDate: DataTypes.DATE,
  status: {
    type: DataTypes.STRING,
    defaultValue: "pending"
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  timestamps: true
});

// ======================
// AUTH MIDDLEWARE
// ======================

function ensureLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// ======================
// HELPER
// ======================

function formatDate(date) {
  return date ? new Date(date).toISOString().split("T")[0] : "";
}

function validateTaskInput(title, dueDate) {
  let errors = [];

  if (!title || !title.trim()) {
    errors.push("Title is required");
  }

  if (!dueDate) {
    errors.push("Due date is required");
  }

  return errors;
}

// ======================
// ROUTES
// ======================

// Home
app.get("/", (req, res) => {
  res.redirect("/login");
});

// ======================
// AUTH ROUTES
// ======================

// REGISTER
app.get("/register", (req, res) => {
  res.render("register", { error: null, title: "Register" });
});

app.post("/register", async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password) {
      return res.render("register", { error: "All fields are required", title: "Register" });
    }

    if (password !== confirmPassword) {
      return res.render("register", { error: "Passwords do not match", title: "Register" });
    }

    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.render("register", { error: "User already exists", title: "Register" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword
    });

    req.session.user = {
      id: newUser._id.toString(),
      username: newUser.username,
      email: newUser.email
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.log(err);
    res.render("register", { error: "Something went wrong", title: "Register" });
  }
});

// LOGIN
app.get("/login", (req, res) => {
  res.render("login", { error: null, title: "Login" });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render("login", { error: "All fields are required", title: "Login" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.render("login", { error: "User not found", title: "Login" });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.render("login", { error: "Invalid password", title: "Login" });
    }

    req.session.user = {
      id: user._id.toString(),
      username: user.username,
      email: user.email
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.log(err);
    res.render("login", { error: "Something went wrong", title: "Login" });
  }
});

// LOGOUT
app.get("/logout", (req, res) => {
  req.session.reset();
  res.redirect("/login");
});

// ======================
// DASHBOARD
// ======================

app.get("/dashboard", ensureLogin, async (req, res) => {
  const total = await Task.count({
    where: { userId: req.session.user.id }
  });

  const completed = await Task.count({
    where: {
      userId: req.session.user.id,
      status: "completed"
    }
  });

  res.render("dashboard", { total, completed, title: "Dashboard" });
});

// ======================
// TASK ROUTES
// ======================

// TASK LIST
app.get("/tasks", ensureLogin, async (req, res) => {
  const tasks = await Task.findAll({
    where: { userId: req.session.user.id },
    order: [["createdAt", "DESC"]]
  });

  const formattedTasks = tasks.map(task => ({
    ...task.toJSON(),
    dueDate: formatDate(task.dueDate)
  }));

  res.render("tasks", { tasks: formattedTasks, title: "Tasks" });
});

// ADD TASK
app.get("/tasks/add", ensureLogin, (req, res) => {
  res.render("addTask", { error: null, title: "Add Task" });
});

app.post("/tasks/add", ensureLogin, async (req, res) => {
  const { title, description, dueDate } = req.body;

  const errors = validateTaskInput(title, dueDate);

  if (errors.length > 0) {
    return res.render("addTask", {
      error: errors.join(", "),
      title: "Add Task"
    });
  }

  await Task.create({
    title: title.trim(),
    description: description?.trim(),
    dueDate: dueDate ? new Date(dueDate) : null,
    userId: req.session.user.id
  });

  res.redirect("/tasks");
});

// EDIT TASK
app.get("/tasks/edit/:id", ensureLogin, async (req, res) => {
  const task = await Task.findOne({
    where: {
      id: req.params.id,
      userId: req.session.user.id
    }
  });

  if (!task || task.status !== "pending") return res.redirect("/tasks");

  const formattedTask = {
    ...task.toJSON(),
    dueDate: formatDate(task.dueDate)
  };

  res.render("editTask", {
    task: formattedTask,
    error: null,
    title: "Edit Task"
  });
});

app.post("/tasks/edit/:id", ensureLogin, async (req, res) => {
  const { title, description, dueDate } = req.body;

  const task = await Task.findOne({
    where: {
      id: req.params.id,
      userId: req.session.user.id
    }
  });
  if (!task || task.status !== "pending") {
    return res.redirect("/tasks");
  }

  const errors = validateTaskInput(title, dueDate);

  if (errors.length > 0) {
    return res.render("editTask", {
      task: {
        ...task.toJSON(),
        dueDate: formatDate(task.dueDate)
      },
      error: errors.join(", "),
      title: "Edit Task"
    });
  }

  await task.update({
    title: title.trim(),
    description: description?.trim(),
    dueDate: dueDate ? new Date(dueDate) : null
  });

  res.redirect("/tasks");
});

// DELETE TASK
app.post("/tasks/delete/:id", ensureLogin, async (req, res) => {
  await Task.destroy({
    where: {
      id: req.params.id,
      userId: req.session.user.id
    }
  });

  res.redirect("/tasks");
});

// TOGGLE STATUS
app.post("/tasks/status/:id", ensureLogin, async (req, res) => {
  const task = await Task.findOne({
    where: {
      id: req.params.id,
      userId: req.session.user.id
    }
  });

  if (!task) return res.redirect("/tasks");

  await task.update({
    status: task.status === "pending" ? "completed" : "pending"
  });

  res.redirect("/tasks");
});

// ======================
// START SERVER
// ======================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
