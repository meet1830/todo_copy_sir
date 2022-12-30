const express = require("express");
const validator = require("validator");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const UserSchema = require("./UserSchema");
const session = require("express-session");
const mongoDBSession = require("connect-mongodb-session")(session);
//models
const TodoModel = require("./models/TodoModel");

//middlewares
const {
  cleanUpAndValidate,
} = require("./utils/AuthUtils");
const isAuth = require("./middleware/isAuth");
const rateLimitng = require("./middleware/rateLimiting");

const app = express();

app.set("view engine", "ejs");

//connection with
mongoose.set("strictQuery", false);
const mongoURI = `mongodb+srv://karan:12345@cluster0.3ije6wh.mongodb.net/auth-node`;
mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then((res) => {
    console.log("Connect to DB successfully");
  })
  .catch((err) => {
    console.log("Failed to connect", err);
  });

//middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

//Adding the session

const store = new mongoDBSession({
  uri: mongoURI,
  collection: "sessions",
});

app.use(
  session({
    secret: "hello backendjs",
    resave: false,
    saveUninitialized: false,
    store: store,
  })
);

//routes
app.get("/", (req, res) => {
  res.send("Welcome to my app");
});

app.get("/login", (req, res) => {
  return res.render("login");
});

app.get("/register", (req, res) => {
  return res.render("register");
});

app.post("/register", async (req, res) => {
  console.log(req.body);
  const { name, email, username, password } = req.body;
  try {
    await cleanUpAndValidate({ name, password, email, username });
  } catch (err) {
    return res.send({
      status: 400,
      message: err,
    });
  }

  //abc123 --> shjsiohc484798@!#
  //bcrypt : md5
  const hashedPassword = await bcrypt.hash(password, 7);

  let user = new UserSchema({
    name: name,
    username: username,
    password: hashedPassword,
    email: email,
  });

  //check if the user already exits

  let userExists;
  try {
    userExists = await UserSchema.findOne({ email });
  } catch (err) {
    return res.send({
      status: 400,
      message: "Internal server error, Please try again",
      error: err,
    });
  }

  if (userExists) {
    return res.send({
      status: 400,
      message: "User already exists",
    });
  }

  //genrate a token
  try {
    const userDB = await user.save(); // create opt in database
    console.log(userDB);
    res.redirect("/login");
  } catch (err) {
    return res.send({
      status: 400,
      message: "Internal Server Error, Please try again",
      error: err,
    });
  }
});

app.post("/login", async (req, res) => {
  console.log(req.session);
  const { loginId, password } = req.body;

  if (
    typeof loginId !== "string" ||
    typeof password !== "string" ||
    !loginId ||
    !password
  ) {
    return res.send({
      status: 400,
      message: "Invalid Data",
    });
  }
  //find return multiple obj inside an array
  //findOne return one object or null

  let userDB;

  try {
    if (validator.isEmail(loginId)) {
      userDB = await UserSchema.findOne({ email: loginId });
    } else {
      userDB = await UserSchema.findOne({ username: loginId });
    }

    console.log(userDB);

    if (!userDB) {
      return res.send({
        status: 400,
        message: "User not found, Please register first",
        error: err,
      });
    }

    //comapre the password
    const isMatch = await bcrypt.compare(password, userDB.password);

    if (!isMatch) {
      return res.send({
        status: 400,
        message: "Invalid Password",
        data: req.body,
      });
    }

    //final return
    req.session.isAuth = true;
    req.session.user = {
      username: userDB.username,
      email: userDB.email,
      userId: userDB._id,
    };

    res.redirect("/dashboard");
  } catch (err) {
    return res.send({
      status: 400,
      message: "Internal Server Error, Please loggin again!",
      error: err,
    });
  }
});

app.get("/home", isAuth, (req, res) => {
  if (req.session.isAuth) {
    return res.send({
      message: "This is your home page",
    });
  } else {
    return res.send({
      message: "Please Logged in again",
    });
  }
});

app.post("/logout", isAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) throw err;

    res.redirect("/login");
  });
});

app.post("/logout_from_all_devices", isAuth, async (req, res) => {
  console.log(req.session.user.username);
  const username = req.session.user.username;

  const Schema = mongoose.Schema;
  const sessionSchema = new Schema({ _id: String }, { strict: false });
  const SesisonModel = mongoose.model("session", sessionSchema);

  try {
    const sessionDb = await SesisonModel.deleteMany({
      "session.user.username": username,
    });
    console.log(sessionDb);
    return res.send({
      status: 200,
      message: "Logged out from all devices",
    });
  } catch (err) {
    return res.send({
      status: 400,
      message: "Logout from all devices failed",
      error: err,
    });
  }
});

app.get("/dashboard", isAuth, async (req, res) => {
  // let todos = [];

  // try {
  //   todos = await TodoModel.find({ username: req.session.user.username });
  //   // return res.send({
  //   //     status: 200,
  //   //     message: "Read successful",
  //   //     data: todos
  //   // })
  //   console.log(todos);
  // } catch (err) {
  //   return res.send({
  //     status: 400,
  //     message: "Database Error. Please try again",
  //   });
  // }
  res.render("dashboard");
});

app.post("/pagination_dashboard", isAuth, async (req, res) => {
  const skip = req.query.skip || 0;
  const LIMIT = 5;
  const username = req.session.user.username;

  //mongodb aggregation -> is we want to perform multiple actions in db, then we use aggregation
  try {
    let todos = await TodoModel.aggregate([
      { $match: { username: username } },
      {
        $facet: {
          data: [{ $skip: parseInt(skip) }, { $limit: LIMIT }],
        },
      },
    ]);

    return res.send({
      status: 200,
      message: "Read Successfully",
      data: todos,
    });
  } catch (err) {
    return res.send({
      status: 400,
      message: "Database error. Please try again",
      error: err,
    });
  }
});

app.post("/create-item", isAuth, rateLimitng, async (req, res) => {
  console.log(req.body);
  const todoText = req.body.todo;

  if (!todoText) {
    return res.send({
      status: 400,
      message: "Missing Parameters",
    });
  }

  if (todoText.length > 100) {
    return res.send({
      status: 400,
      message: "Todo text is very long. Max 100 characters allowd.",
    });
  }

  let todo = new TodoModel({
    todo: todoText,
    username: req.session.user.username,
  });

  try {
    const todoDb = await todo.save();
    return res.send({
      status: 200,
      message: "Todo created successfully",
      data: todoDb,
    });
  } catch (err) {
    return res.send({
      status: 400,
      message: "Database error, Please Try again.",
    });
  }
});

app.post("/edit-item", isAuth, async (req, res) => {
  const id = req.body.id;
  const newData = req.body.newData;
  console.log(req.body);
  if (!id || !newData) {
    return res.send({
      status: 404,
      message: "Missing Paramters.",
      error: "Missing todo data",
    });
  }

  try {
    const todoDb = await TodoModel.findOneAndUpdate(
      { _id: id },
      { todo: newData }
    );
    return res.send({
      status: 200,
      message: "Updated todo succesfully",
      data: todoDb,
    });
  } catch (err) {
    return res.send({
      status: 400,
      message: "Database error, Please Try again.",
      error: err,
    });
  }
});

app.post("/delete-item", isAuth, async (req, res) => {
  const id = req.body.id;
  console.log(req.body);
  if (!id) {
    return res.send({
      status: 404,
      message: "Missing parameters",
      error: "Missing id of todo to delete",
    });
  }

  try {
    const todoDb = await TodoModel.findOneAndDelete({ _id: id });

    return res.send({
      status: 200,
      message: "Todo Deleted Succesfully",
      data: todoDb,
    });
  } catch (err) {
    return res.send({
      status: 400,
      message: "Database error. Please try again.",
      error: err,
    });
  }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Listenning on port ${PORT}`);
});

//Create an ejs Template for register and loggin
//hashed Password
//Create a mongoDB connection
//User Schema

//lecture 7
//checkuser before insertion /register

//'/login'
//validate the data
//find user using either mail or username
//for found user matched the password
//include session info to check futher
//adding session and on database

//dashboard template
//'logout' and 'logout from all devices
//isAuth

//create item, edit item, delete item
//axios package
//browser
//pagination
//rate limiting
